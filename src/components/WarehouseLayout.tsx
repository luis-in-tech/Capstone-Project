import { SearchBar } from '@/components/ui/search-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WarehouseFloorplan, type PendingZoneConversion } from './WarehouseFloorplan';
import { ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight, ArrowsLeftRightIcon as ArrowsLeftRight, SquaresFourIcon as Grid2X2, InfoIcon as Info, SpinnerGapIcon as Loader2, PackageIcon as Package, PlusIcon as Plus, WarehouseIcon } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStaffAccess } from '../hooks/useStaffAccess';
import { useAuth } from '../hooks/useAuth';
import { hasAdminRole } from '../lib/staffPermissions';
import { assignLocalQuantity, localLayoutKey, readLocalLayout, validLocalAllocations } from '../lib/warehouseLayoutLocal';
import { boxPropsFromShape, readCachedFloorplanMeta, suggestZoneNameFromShape, type FloorplanShape } from '../lib/warehouseFloorplan';
import { supabase } from '../lib/supabase';
import { pickDefaultWarehouse, sortWarehousesForLayout, type WarehouseZone, type ZoneAllocation } from '../lib/warehouseLayout';
import type { Product, InventoryItem, Warehouse } from '../types';

const ZONE_TABLE_PAGE_SIZE = 50;
const EMPTY_SUMMARY = { units: 0, products: 0 };

export function WarehouseLayout({ warehouses, products, inventory }: { warehouses: Warehouse[]; products: Product[]; inventory: InventoryItem[] }) {
  const access = useStaffAccess();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = hasAdminRole(profile);
  const [temporary, setTemporary] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearingMap, setClearingMap] = useState(false);
  const [mapResetKey, setMapResetKey] = useState(0);
  const warehouseAccess = access.permissions.warehouseAccess;
  const warehouseIds = access.permissions.warehouseIds;
  const allowed = useMemo(
    () => sortWarehousesForLayout(
      warehouses.filter(w => warehouseAccess === 'all' || warehouseIds.includes(w.id)),
    ),
    [warehouses, warehouseAccess, warehouseIds],
  );
  const [warehouseId, setWarehouseId] = useState('');
  const defaultWarehouse = useMemo(() => pickDefaultWarehouse(allowed), [allowed]);
  const warehouse = allowed.find(w => w.id === warehouseId) || defaultWarehouse;
  const id = warehouse?.id || '';
  const storageKey = localLayoutKey(import.meta.env.VITE_SUPABASE_URL || '', profile?.uid || '', id);
  const canEdit = access.permissions.inventory === 'adjust' && !access.loading && !access.error && !access.revoked && !!id;
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [allocations, setAllocations] = useState<ZoneAllocation[]>([]);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [mapSearch, setMapSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const cachedFloorplanMeta = useMemo(() => readCachedFloorplanMeta(storageKey), [storageKey, mapResetKey, reload]);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ mode: 'add' | 'rename' | 'delete'; zone?: WarehouseZone; fromShape?: FloorplanShape } | null>(null);
  const [pendingZoneConversion, setPendingZoneConversion] = useState<PendingZoneConversion | null>(null);
  const [floorplanDirty, setFloorplanDirty] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<{ kind: 'warehouse'; id: string } | { kind: 'add-warehouse' } | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkZoneId, setBulkZoneId] = useState<string>('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const [assignTarget, setAssignTarget] = useState<{ product: Product; currentZoneId: string; availableQty: number } | null>(null);
  const [targetZoneId, setTargetZoneId] = useState<string>('');
  const [assignQuantity, setAssignQuantity] = useState<number>(0);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState('');
  const lastLoadAtRef = useRef(0);
  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;

  useEffect(() => {
    setSelectedProductIds([]);
    setTablePage(1);
  }, [search]);

  useEffect(() => {
    setSelectedProductIds([]);
    setBulkZoneId('');
    setAssignTarget(null);
    setTablePage(1);
  }, [selected, id]);

  useEffect(() => { setSelected(''); setSearch(''); setMapSearch(''); setEditor(null); setLoading(true); setZones([]); setAllocations([]); setTemporary(false); }, [id, storageKey]);
  useEffect(() => {
    let active = true;
    setError('');
    if (!id) { setLoading(false); return; }
    async function load() {
      try {
        const [z, a] = await Promise.all([
          supabase.from('warehouse_zones').select('*').eq('warehouseId', id).order('sortOrder').order('id'),
          supabase.from('warehouse_zone_allocations').select('*').eq('warehouseId', id),
        ]);
        if (!active) return;
        const failures = [
          { table: 'warehouse_zones', error: z.error },
          { table: 'warehouse_zone_allocations', error: a.error },
        ].filter(result => result.error);
        if (failures.length && failures.every(({ error }) => error && ['PGRST205', '42P01'].includes(error.code))) {
          const saved = readLocalLayout(localStorage, storageKey, id);
          const pruned = validLocalAllocations(saved, inventoryRef.current, id);
          if (pruned.length !== saved.allocations.length) {
            localStorage.setItem(storageKey, JSON.stringify({ ...saved, allocations: pruned }));
          }
          setZones(saved.zones); setAllocations(pruned); setTemporary(true);
          setSelected(previous => previous && previous !== 'unassigned' && !saved.zones.some(zone => zone.id === previous) ? 'unassigned' : previous);
        } else if (failures.length) {
          setError(failures.map(({ table, error }) => {
            if (!error) return `The database request failed for ${table}.`;
            const guidance = ['PGRST205', '42P01'].includes(error.code)
              ? 'The zone table is missing from this app’s connected database or its API schema cache.'
              : error.code === '42501' ? 'The database denied access to zone data.'
              : ['PGRST301', 'PGRST303'].includes(error.code) ? 'Your sign-in session could not be verified. Sign out and sign in again.'
              : 'The database request failed.';
            return `${guidance} ${table}${error.code ? ` [${error.code}]` : ''}: ${error.message}${error.hint ? ` Hint: ${error.hint}` : ''}`;
          }).join('\n\n'));
        } else {
          const zoneData = (z.data ?? []) as WarehouseZone[];
          setZones(zoneData); setAllocations((a.data ?? []) as ZoneAllocation[]);
          setSelected(previous => previous && previous !== 'unassigned' && !zoneData.some(zone => zone.id === previous) ? 'unassigned' : previous);
        }
      } catch (cause) {
        if (active) setError(`Unable to connect to warehouse data: ${cause instanceof Error ? cause.message : 'Check your connection and retry.'}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load().then(() => {
      if (active) lastLoadAtRef.current = Date.now();
    });
    return () => { active = false; };
  }, [id, reload, storageKey]);

  useEffect(() => {
    if (!temporary || !id) return;
    try {
      const saved = readLocalLayout(localStorage, storageKey, id);
      const pruned = validLocalAllocations(saved, inventory, id);
      if (pruned.length !== saved.allocations.length) {
        localStorage.setItem(storageKey, JSON.stringify({ ...saved, allocations: pruned }));
      }
      setAllocations(pruned);
    } catch {
      // Ignore malformed local layout on background inventory updates
    }
  }, [temporary, id, storageKey, inventory]);

  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) setReload(n => n + 1); };
    const refreshOnFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadAtRef.current < 30_000) return;
      lastLoadAtRef.current = Date.now();
      setReload(n => n + 1);
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [storageKey]);

  const layoutQuantities = useMemo(() => {
    const stockByProduct = new Map<string, number>();
    const allocatedTotalByProduct = new Map<string, number>();
    const zoneProductQty = new Map<string, Map<string, number>>();
    const zoneSummaries = new Map<string, { units: number; products: number }>();

    if (id) {
      for (const row of inventory) {
        if (row.warehouseId !== id) continue;
        stockByProduct.set(row.productId, (stockByProduct.get(row.productId) || 0) + Number(row.quantity || 0));
      }

      for (const row of allocations) {
        if (row.warehouseId !== id) continue;
        const qty = Number(row.quantity);
        allocatedTotalByProduct.set(row.productId, (allocatedTotalByProduct.get(row.productId) || 0) + qty);
        let prodMap = zoneProductQty.get(row.zoneId);
        if (!prodMap) {
          prodMap = new Map<string, number>();
          zoneProductQty.set(row.zoneId, prodMap);
        }
        prodMap.set(row.productId, (prodMap.get(row.productId) || 0) + qty);
      }
    }

    let unassignedUnits = 0;
    let unassignedProducts = 0;
    for (const p of products) {
      const whQty = stockByProduct.get(p.id) || 0;
      const allocQty = allocatedTotalByProduct.get(p.id) || 0;
      const unQty = whQty - allocQty;
      unassignedUnits += unQty;
      if (unQty !== 0) {
        unassignedProducts++;
      }
    }
    zoneSummaries.set('unassigned', { units: unassignedUnits, products: unassignedProducts });

    for (const [zId, prodMap] of zoneProductQty.entries()) {
      let units = 0;
      let prodCount = 0;
      for (const p of products) {
        const qty = prodMap.get(p.id) || 0;
        if (qty !== 0) {
          units += qty;
          prodCount++;
        }
      }
      zoneSummaries.set(zId, { units, products: prodCount });
    }

    return { stockByProduct, allocatedTotalByProduct, zoneProductQty, zoneSummaries };
  }, [allocations, id, inventory, products]);

  const count = useCallback((product: string, zone: string) => {
    if (!id || !zone) return 0;
    if (zone === 'unassigned') {
      return (layoutQuantities.stockByProduct.get(product) || 0) - (layoutQuantities.allocatedTotalByProduct.get(product) || 0);
    }
    return layoutQuantities.zoneProductQty.get(zone)?.get(product) || 0;
  }, [id, layoutQuantities]);

  const summaries = useCallback((zone: string) => {
    return layoutQuantities.zoneSummaries.get(zone) ?? EMPTY_SUMMARY;
  }, [layoutQuantities]);

  const rows = useMemo(() => {
    if (!selected) return [];
    const term = search.trim().toLowerCase();
    return products.filter(p => {
      if (count(p.id, selected) === 0) return false;
      if (!term) return true;
      return `${p.sku} ${p.name} ${p.category} ${p.supplier || ''}`.toLowerCase().includes(term);
    });
  }, [count, products, search, selected]);

  const selectedZone = zones.find(z => z.id === selected);
  const selectedName = selected === 'unassigned' ? 'Unassigned' : selectedZone?.name;

  async function saveZone() {
    if (!editor || !canEdit || saving) return;
    setSaving(true); setFormError('');
    try {
      const trimmed = name.trim();
      let createdZoneId: string | null = null;
      if (temporary) {
        const saved = readLocalLayout(localStorage, storageKey, id);
        if (editor.mode !== 'delete') {
          if (!trimmed || trimmed.length > 60) throw new Error('Enter a zone name between 1 and 60 characters.');
          if (saved.zones.some(z => z.id !== editor.zone?.id && z.name.toLowerCase() === trimmed.toLowerCase())) throw new Error('A zone with this name already exists in this warehouse.');
        }
        if (editor.mode !== 'add' && !saved.zones.some(z => z.id === editor.zone?.id)) throw new Error('Zone no longer exists. Refresh the layout.');
        if (editor.mode === 'add') {
          createdZoneId = crypto.randomUUID();
          saved.zones.push({ id: createdZoneId, warehouseId: id, name: trimmed, sortOrder: Math.max(-1, ...saved.zones.map(z => z.sortOrder)) + 1 });
        }
        else if (editor.mode === 'rename') saved.zones = saved.zones.map(z => z.id === editor.zone?.id ? { ...z, name: trimmed } : z);
        else { saved.zones = saved.zones.filter(z => z.id !== editor.zone?.id); saved.allocations = saved.allocations.filter(a => a.zoneId !== editor.zone?.id); }
        localStorage.setItem(storageKey, JSON.stringify(saved));
      } else {
        const { error } = await supabase.rpc('manage_warehouse_zone', { p_warehouse: id, p_zone: editor.zone?.id || null, p_action: editor.mode, p_name: trimmed });
        if (error) throw error;
        if (editor.mode === 'add' && editor.fromShape) {
          const { data: fetchedZones } = await supabase.from('warehouse_zones').select('id, name').eq('warehouseId', id);
          const matched = (fetchedZones ?? []).find(z => String(z.name || '').trim().toLowerCase() === trimmed.toLowerCase());
          createdZoneId = matched?.id ?? null;
        }
      }
      if (editor.mode === 'add' && editor.fromShape && createdZoneId) {
        const sourceShape = editor.fromShape;
        const convertedBox = boxPropsFromShape(sourceShape);
        setPendingZoneConversion(prev => ({
          seq: (prev?.seq ?? 0) + 1,
          sourceShapeId: sourceShape.id,
          zoneId: createdZoneId!,
          box: convertedBox,
        }));
      }
      if (editor.mode === 'delete' && selected === editor.zone?.id) setSelected('unassigned');
      setEditor(null); setReload(n => n + 1);
      toast.success(
        editor.mode === 'delete'
          ? 'Zone deleted. Its stock is now Unassigned.'
          : editor.fromShape && createdZoneId
            ? `Converted box to zone "${trimmed}"`
            : 'Zone saved',
      );
    } catch (e) { setFormError((e as Error).message || 'Unable to save zone.'); }
    finally { setSaving(false); }
  }

  async function handleClearMap() {
    if (!canEdit || clearingMap || !id) return;
    setClearingMap(true);
    try {
      if (temporary) {
        const saved = readLocalLayout(localStorage, storageKey, id);
        saved.zones = [];
        saved.allocations = [];
        localStorage.setItem(storageKey, JSON.stringify(saved));
      } else {
        for (const z of zones) {
          const { error: rpcErr } = await supabase.rpc('manage_warehouse_zone', {
            p_warehouse: id,
            p_zone: z.id,
            p_action: 'delete',
            p_name: z.name,
          });
          if (rpcErr) throw rpcErr;
        }
      }
      const emptyPlan = { boxes: {}, doors: [{ id: 'entrance', edge: 'bottom', offset: 50 }], shapes: [] };
      try {
        window.localStorage.setItem(`${storageKey}:floorplan`, JSON.stringify(emptyPlan));
        window.localStorage.removeItem(`${storageKey}:floorplan:draft`);
      } catch {
        // ignore localStorage quota errors
      }
      if (!temporary) {
        const { error: floorErr } = await supabase
          .from('warehouse_floorplans')
          .upsert({ warehouseId: id, layout: emptyPlan }, { onConflict: 'warehouseId' });
        if (floorErr && !['PGRST205', '42P01'].includes(floorErr.code || '')) {
          throw floorErr;
        }
      }
      setSelected('');
      setClearConfirmOpen(false);
      setMapResetKey(n => n + 1);
      setReload(n => n + 1);
      toast.success(
        zones.length > 0
          ? `Cleared all zones in ${warehouse?.name || 'warehouse'}. Map is now empty.`
          : `Cleared floorplan layout in ${warehouse?.name || 'warehouse'}. Map is now empty.`,
      );
    } catch (e) {
      toast.error((e as Error).message || 'Unable to clear map zones.');
    } finally {
      setClearingMap(false);
    }
  }

  async function executeDbZoneMoves(
    moves: Array<{ prodId: string; fromZone: string; toZone: string; qty: number }>,
  ) {
    // 1. Validate all source allocations exist with sufficient stock before mutating
    const preparedMoves = moves.map(m => {
      let existingFrom: ZoneAllocation | undefined;
      if (m.fromZone !== 'unassigned') {
        existingFrom = allocations.find(
          a => a.warehouseId === id && a.zoneId === m.fromZone && a.productId === m.prodId,
        );
        if (!existingFrom || (existingFrom.quantity || 0) < m.qty) {
          throw new Error('Source zone allocation no longer has enough stock. Refresh the layout and try again.');
        }
      }
      const existingTo = m.toZone !== 'unassigned'
        ? allocations.find(a => a.warehouseId === id && a.zoneId === m.toZone && a.productId === m.prodId)
        : undefined;
      return { ...m, existingFrom, existingTo };
    });

    const createdToIds: string[] = [];
    const updatedRows: Array<{ id: string; prevQty: number }> = [];
    const deletedRows: Array<Omit<ZoneAllocation, 'id'>> = [];

    try {
      // 2. Write destination allocations FIRST so a failure never leaves stock silently deleted from source
      for (const m of preparedMoves) {
        if (m.toZone === 'unassigned') continue;
        const curTo = m.existingTo?.quantity || 0;
        const nextTo = curTo + m.qty;
        if (m.existingTo) {
          updatedRows.push({ id: m.existingTo.id, prevQty: curTo });
          const { error: upErr } = await supabase
            .from('warehouse_zone_allocations')
            .update({ quantity: nextTo })
            .eq('id', m.existingTo.id);
          if (upErr) throw upErr;
        } else {
          const { data: inserted, error: inErr } = await supabase
            .from('warehouse_zone_allocations')
            .insert({ warehouseId: id, zoneId: m.toZone, productId: m.prodId, quantity: nextTo })
            .select('id')
            .single();
          if (inErr) throw inErr;
          if (inserted?.id) createdToIds.push(inserted.id);
        }
      }

      // 3. Decrement/delete source allocations only after all destination writes succeed
      for (const m of preparedMoves) {
        if (m.fromZone === 'unassigned' || !m.existingFrom) continue;
        const curFrom = m.existingFrom.quantity || 0;
        const nextFrom = Math.max(0, curFrom - m.qty);
        if (nextFrom === 0) {
          const { error: delErr } = await supabase
            .from('warehouse_zone_allocations')
            .delete()
            .eq('id', m.existingFrom.id);
          if (delErr) throw delErr;
          deletedRows.push({ warehouseId: id, zoneId: m.fromZone, productId: m.prodId, quantity: curFrom });
        } else {
          updatedRows.push({ id: m.existingFrom.id, prevQty: curFrom });
          const { error: upErr } = await supabase
            .from('warehouse_zone_allocations')
            .update({ quantity: nextFrom })
            .eq('id', m.existingFrom.id);
          if (upErr) throw upErr;
        }
      }
    } catch (err) {
      // Compensation rollback
      for (const rowId of createdToIds) {
        await supabase.from('warehouse_zone_allocations').delete().eq('id', rowId);
      }
      for (const upd of [...updatedRows].reverse()) {
        await supabase.from('warehouse_zone_allocations').update({ quantity: upd.prevQty }).eq('id', upd.id);
      }
      for (const del of deletedRows) {
        await supabase.from('warehouse_zone_allocations').insert(del);
      }
      throw err;
    }
  }

  async function handleSingleAssign() {
    if (!assignTarget || !targetZoneId || assignTarget.availableQty <= 0 || assignQuantity <= 0 || assignSaving || !canEdit) return;
    if (assignQuantity > assignTarget.availableQty) {
      setAssignError(`Quantity exceeds available ${assignTarget.availableQty.toLocaleString()} units.`);
      return;
    }
    setAssignSaving(true);
    setAssignError('');
    const fromZone = assignTarget.currentZoneId;
    const toZone = targetZoneId;
    const prodId = assignTarget.product.id;
    const qty = assignQuantity;
    const targetName = toZone === 'unassigned' ? 'Unassigned Stock' : (zones.find(z => z.id === toZone)?.name || 'Zone');

    try {
      if (temporary) {
        let saved = readLocalLayout(localStorage, storageKey, id);
        if (fromZone !== 'unassigned') {
          const curFrom = saved.allocations.find(a => a.warehouseId === id && a.zoneId === fromZone && a.productId === prodId)?.quantity || 0;
          saved = assignLocalQuantity(saved, inventory, id, fromZone, prodId, Math.max(0, curFrom - qty));
        }
        if (toZone !== 'unassigned') {
          const curTo = saved.allocations.find(a => a.warehouseId === id && a.zoneId === toZone && a.productId === prodId)?.quantity || 0;
          saved = assignLocalQuantity(saved, inventory, id, toZone, prodId, curTo + qty);
        }
        localStorage.setItem(storageKey, JSON.stringify(saved));
        setAllocations(validLocalAllocations(saved, inventory, id));
      } else {
        await executeDbZoneMoves([{ prodId, fromZone, toZone, qty }]);
        setReload(n => n + 1);
      }
      toast.success(`Moved ${qty.toLocaleString()} units of ${assignTarget.product.name} to ${targetName}`);
      setAssignTarget(null);
    } catch (e) {
      if (!temporary) setReload(n => n + 1);
      setAssignError((e as Error).message || 'Unable to update zone allocation.');
    } finally {
      setAssignSaving(false);
    }
  }

  async function handleBulkAssign() {
    if (!bulkZoneId || !selectedProductIds.length || bulkSaving || !canEdit) return;
    setBulkSaving(true);
    const targetName = bulkZoneId === 'unassigned' ? 'Unassigned Stock' : (zones.find(z => z.id === bulkZoneId)?.name || 'Zone');
    let totalMovedUnits = 0;
    let productsCount = 0;

    try {
      const moves = selectedProductIds
        .map(prodId => ({ prodId, fromZone: selected, toZone: bulkZoneId, qty: count(prodId, selected) }))
        .filter(m => m.qty > 0);
      totalMovedUnits = moves.reduce((s, m) => s + m.qty, 0);
      productsCount = moves.length;

      if (temporary) {
        let saved = readLocalLayout(localStorage, storageKey, id);
        for (const m of moves) {
          if (m.fromZone !== 'unassigned') {
            const curFrom = saved.allocations.find(a => a.warehouseId === id && a.zoneId === m.fromZone && a.productId === m.prodId)?.quantity || 0;
            saved = assignLocalQuantity(saved, inventory, id, m.fromZone, m.prodId, Math.max(0, curFrom - m.qty));
          }
          if (m.toZone !== 'unassigned') {
            const curTo = saved.allocations.find(a => a.warehouseId === id && a.zoneId === m.toZone && a.productId === m.prodId)?.quantity || 0;
            saved = assignLocalQuantity(saved, inventory, id, m.toZone, m.prodId, curTo + m.qty);
          }
        }
        localStorage.setItem(storageKey, JSON.stringify(saved));
        setAllocations(validLocalAllocations(saved, inventory, id));
      } else {
        await executeDbZoneMoves(moves);
        setReload(n => n + 1);
      }
      toast.success(`Assigned ${productsCount} products (${totalMovedUnits.toLocaleString()} units) to ${targetName}`);
      setSelectedProductIds([]);
      setBulkZoneId('');
    } catch (e) {
      if (!temporary) setReload(n => n + 1);
      toast.error((e as Error).message || 'Unable to complete bulk assignment.');
    } finally {
      setBulkSaving(false);
    }
  }

  const selectedSummary = summaries(selected);
  const unassignedSummary = summaries('unassigned');
  const selectedProductIdSet = useMemo(() => new Set(selectedProductIds), [selectedProductIds]);
  const allVisibleSelected = useMemo(
    () => rows.length > 0 && rows.every(p => selectedProductIdSet.has(p.id)),
    [rows, selectedProductIdSet],
  );
  const someVisibleSelected = useMemo(
    () => rows.some(p => selectedProductIdSet.has(p.id)) && !allVisibleSelected,
    [allVisibleSelected, rows, selectedProductIdSet],
  );
  const totalSelectedUnits = useMemo(
    () => rows.reduce((sum, p) => (selectedProductIdSet.has(p.id) ? sum + count(p.id, selected) : sum), 0),
    [count, rows, selected, selectedProductIdSet],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / ZONE_TABLE_PAGE_SIZE));
  const currentPage = Math.min(tablePage, totalPages);
  const pageStart = (currentPage - 1) * ZONE_TABLE_PAGE_SIZE;
  const pagedRows = useMemo(
    () => rows.slice(pageStart, pageStart + ZONE_TABLE_PAGE_SIZE),
    [pageStart, rows],
  );
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const scrollSyncSourceRef = useRef<'top' | 'table' | null>(null);
  const scrollSyncRafRef = useRef<number | null>(null);
  const [tableScrollMetrics, setTableScrollMetrics] = useState({ width: 0, overflow: false });
  const showZoneTable = Boolean(warehouse && !loading && !error && selectedName);

  useEffect(() => () => {
    if (scrollSyncRafRef.current !== null) {
      cancelAnimationFrame(scrollSyncRafRef.current);
    }
  }, []);

  const syncHorizontalScroll = useCallback((source: 'top' | 'table', fromEl: HTMLElement, toEl: HTMLElement) => {
    if (scrollSyncSourceRef.current && scrollSyncSourceRef.current !== source) return;
    scrollSyncSourceRef.current = source;
    if (toEl.scrollLeft !== fromEl.scrollLeft) {
      toEl.scrollLeft = fromEl.scrollLeft;
    }
    if (scrollSyncRafRef.current !== null) cancelAnimationFrame(scrollSyncRafRef.current);
    scrollSyncRafRef.current = requestAnimationFrame(() => {
      scrollSyncSourceRef.current = null;
      scrollSyncRafRef.current = null;
    });
  }, []);

  const handleTopScroll = useCallback(() => {
    const topEl = topScrollRef.current;
    const tableContainer = tableWrapperRef.current?.querySelector<HTMLDivElement>('[data-slot="table-container"]');
    if (topEl && tableContainer) syncHorizontalScroll('top', topEl, tableContainer);
  }, [syncHorizontalScroll]);

  useEffect(() => {
    if (!showZoneTable) {
      setTableScrollMetrics(prev => (prev.width === 0 && !prev.overflow ? prev : { width: 0, overflow: false }));
      return;
    }

    const tableContainer = tableWrapperRef.current?.querySelector<HTMLDivElement>('[data-slot="table-container"]');
    if (!tableContainer) return;

    const updateMetrics = () => {
      const clientWidth = tableContainer.clientWidth;
      if (clientWidth === 0) return;
      const scrollWidth = tableContainer.scrollWidth;
      const overflow = scrollWidth > clientWidth + 1;
      setTableScrollMetrics(prev => (
        prev.width === scrollWidth && prev.overflow === overflow
          ? prev
          : { width: scrollWidth, overflow }
      ));
      const topEl = topScrollRef.current;
      if (topEl && Math.abs(topEl.scrollLeft - tableContainer.scrollLeft) > 1) {
        syncHorizontalScroll('table', tableContainer, topEl);
      }
    };

    const handleTableScroll = () => {
      const topEl = topScrollRef.current;
      if (topEl) syncHorizontalScroll('table', tableContainer, topEl);
    };

    updateMetrics();
    tableContainer.addEventListener('scroll', handleTableScroll, { passive: true });
    window.addEventListener('resize', updateMetrics);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateMetrics);
      observer.observe(tableContainer);
      const tableEl = tableContainer.querySelector('table');
      if (tableEl) observer.observe(tableEl);
    }

    return () => {
      tableContainer.removeEventListener('scroll', handleTableScroll);
      window.removeEventListener('resize', updateMetrics);
      observer?.disconnect();
    };
  }, [showZoneTable, search, currentPage, pagedRows.length, selected, canEdit, zones.length, syncHorizontalScroll]);

  useEffect(() => {
    if (!tableScrollMetrics.overflow) return;
    const topEl = topScrollRef.current;
    const tableContainer = tableWrapperRef.current?.querySelector<HTMLDivElement>('[data-slot="table-container"]');
    if (topEl && tableContainer && Math.abs(topEl.scrollLeft - tableContainer.scrollLeft) > 1) {
      syncHorizontalScroll('table', tableContainer, topEl);
    }
  }, [tableScrollMetrics.overflow, tableScrollMetrics.width, syncHorizontalScroll]);

  const destinationOptions = useMemo(() => (
    selected === 'unassigned'
      ? zones.map(z => ({ value: z.id, label: z.name }))
      : [
          ...zones.filter(z => z.id !== selected).map(z => ({ value: z.id, label: z.name })),
          { value: 'unassigned', label: 'Unassigned Stock (Return to unallocated)' }
        ]
  ), [selected, zones]);

  const mapSearchMatches = useMemo(() => {
    const q = mapSearch.trim().toLowerCase();
    if (!q || !id) {
      return {
        active: false,
        matchingProductsCount: 0,
        highlightedZones: undefined as Record<string, { units: number; products: number }> | undefined,
        unassignedUnits: 0,
        zoneUnitsTotal: 0,
      };
    }
    const matchingProducts = products.filter(p =>
      `${p.sku} ${p.name} ${p.category || ''} ${p.supplier || ''}`.toLowerCase().includes(q),
    );
    const highlightedZones: Record<string, { units: number; products: number }> = {};
    let zoneUnitsTotal = 0;
    let unassignedUnits = 0;

    for (const p of matchingProducts) {
      const u = count(p.id, 'unassigned');
      if (u > 0) unassignedUnits += u;
      for (const z of zones) {
        const qty = count(p.id, z.id);
        if (qty > 0) {
          const cur = highlightedZones[z.id] ?? { units: 0, products: 0 };
          highlightedZones[z.id] = { units: cur.units + qty, products: cur.products + 1 };
          zoneUnitsTotal += qty;
        }
      }
    }
    return {
      active: true,
      matchingProductsCount: matchingProducts.length,
      highlightedZones,
      unassignedUnits,
      zoneUnitsTotal,
    };
  }, [mapSearch, id, products, zones, count]);

  const handleFloorplanSelect = useCallback((zoneId: string) => {
    setSelected(zoneId);
    setSearch('');
    setMapSearch('');
  }, []);

  const handleZoneAction = useCallback((mode: 'add' | 'rename' | 'delete', zone?: WarehouseZone, fromShape?: FloorplanShape) => {
    let defaultZoneNumber = 1;
    while (zones.some(z => z.name.toLowerCase() === `zone ${defaultZoneNumber}`)) {
      defaultZoneNumber++;
    }
    setEditor({ mode, zone, fromShape });
    setName(
      fromShape
        ? suggestZoneNameFromShape(fromShape.label, zones.map(z => z.name))
        : zone?.name || `Zone ${defaultZoneNumber}`,
    );
    setFormError('');
  }, [zones]);

  const handleClearAllZones = useCallback(() => {
    setClearConfirmOpen(true);
  }, []);

  function floorplan(compact = false) {
    return <WarehouseFloorplan key={`${storageKey}:${compact}`} warehouseId={id} storageKey={storageKey} zones={zones}
      canEdit={canEdit && !compact} compact={compact} selected={selected} resetKey={mapResetKey} summary={summaries}
      highlightedZones={!compact ? mapSearchMatches.highlightedZones : undefined}
      pendingZoneConversion={!compact ? pendingZoneConversion : undefined}
      onDirtyChange={!compact ? setFloorplanDirty : undefined}
      onSelect={handleFloorplanSelect}
      onZoneAction={handleZoneAction}
      onClearAllZones={handleClearAllZones} />;
  }

  function unassignedCard() {
    const matchedUnassigned = mapSearchMatches.active ? mapSearchMatches.unassignedUnits : 0;
    return <button type="button" onClick={() => { setSelected('unassigned'); setSearch(''); setMapSearch(''); }} aria-pressed={selected === 'unassigned'}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-muted/30 p-4 text-left transition hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring ${matchedUnassigned > 0 ? 'ring-2 ring-gold' : ''}`}>
      <div className="flex items-center gap-3">
        <Package className="size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold">Unassigned Stock</p>
          <p className="mt-1 text-xs text-muted-foreground">{unassignedSummary.units.toLocaleString()} units · {unassignedSummary.products.toLocaleString()} products</p>
          <p className="mt-1 text-xs text-muted-foreground">Stock not yet allocated to a zone.</p>
        </div>
      </div>
      {matchedUnassigned > 0 && (
        <span className="shrink-0 rounded-full bg-gold px-2.5 py-1 text-xs font-bold text-foreground">
          {matchedUnassigned.toLocaleString()} matched
        </span>
      )}
    </button>;
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-bold">{selectedName ? 'Zone Inventory' : 'Warehouse Layout'}</h2><Badge variant="outline" className="gap-1.5"><Grid2X2 className="size-3" />Not to Scale</Badge></div>
    {temporary && !error && <div role="status" className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs"><Info className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Temporary layout · Saved in this browser</p><p className="mt-1 text-muted-foreground">Zones and allocations are local to your account in this browser; they do not sync with Inventory Movement.</p><details className="mt-1 text-muted-foreground"><summary className="w-fit cursor-pointer">Storage details</summary><p className="mt-1">Clearing browser data removes this layout. If stock falls below temporary allocations, that product appears as Unassigned. Temporary data is not automatically imported when database storage becomes available.</p></details></div></div>}
    <div className="grid min-h-17 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="flex w-full min-w-0 flex-col gap-2">
        <Label htmlFor="layout-warehouse">Warehouse</Label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
            <Select
              value={id}
              onValueChange={v => {
                const nextId = v || '';
                if (floorplanDirty && nextId && nextId !== id) {
                  setPendingLeaveAction({ kind: 'warehouse', id: nextId });
                  return;
                }
                setWarehouseId(nextId);
              }}
            >
              <SelectTrigger id="layout-warehouse" className="w-full bg-card"><SelectValue placeholder="Select warehouse">{warehouse?.name || 'Select warehouse'}</SelectValue></SelectTrigger>
              <SelectContent>{allowed.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {isAdmin && !selectedName && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                if (floorplanDirty) {
                  setPendingLeaveAction({ kind: 'add-warehouse' });
                  return;
                }
                navigate('/supply-chain?view=warehouses&action=add');
              }}
            >
              <Plus className="size-4" />
              Add Warehouse
            </Button>
          )}
        </div>
      </div>
      {!selectedName && !error && (
        <div className="flex w-full flex-col gap-2 sm:w-80">
          <Label htmlFor="map-sku-finder">Find Product / SKU on Map</Label>
          <SearchBar
            id="map-sku-finder"
            aria-label="Find product or SKU on map"
            placeholder="Search SKU, item name, or category..."
            value={mapSearch}
            disabled={loading || !warehouse}
            onValueChange={setMapSearch}
          />
        </div>
      )}
    </div>
    {!selectedName && !loading && !error && mapSearchMatches.active && (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-2 text-xs">
        <span>
          {mapSearchMatches.matchingProductsCount === 0
            ? `No products matching "${mapSearch.trim()}".`
            : `Found ${mapSearchMatches.matchingProductsCount} matching SKU(s): ${mapSearchMatches.zoneUnitsTotal.toLocaleString()} units in ${Object.keys(mapSearchMatches.highlightedZones ?? {}).length} zone(s)${mapSearchMatches.unassignedUnits > 0 ? `, ${mapSearchMatches.unassignedUnits.toLocaleString()} in Unassigned` : ''}.`}
        </span>
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setMapSearch('')}>
          Clear
        </Button>
      </div>
    )}
    {!warehouse ? <div className="rounded-2xl border p-12 text-center text-muted-foreground">No warehouses are available for your account.</div> : loading ? (
      <div className="space-y-5">
        <section aria-busy="true" className="rounded-2xl border bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gold/20" />
            <div className="space-y-1.5">
              <div className="h-4 w-44 rounded bg-muted" />
              <div className="h-3 w-32 rounded bg-muted/70" />
            </div>
          </div>
          <div className="space-y-4">
            {canEdit && <div className="h-9 w-28 rounded-md bg-muted/50" />}
            {cachedFloorplanMeta?.hasTabs && <div className="h-8 w-64 rounded-md bg-muted/40" />}
            <div className="p-4">
              <div
                role="status"
                style={{ height: `${cachedFloorplanMeta?.height ?? 520}px` }}
                className="flex items-center justify-center border-[3px] border-foreground/20 bg-muted/15 text-sm text-muted-foreground"
              >
                <Loader2 className="mr-2 size-5 animate-spin" />Loading warehouse layout...
              </div>
            </div>
            <div className="h-4" />
          </div>
          <div className="mt-5 h-4 w-80 max-w-full rounded bg-muted/60" />
        </section>
        <div className="h-22 rounded-xl border bg-muted/30" />
      </div>
    ) : error ? <div role="alert" className="rounded-xl border p-6"><p>{error}</p><Button variant="outline" className="mt-3" onClick={() => setReload(n => n + 1)}>Retry</Button></div> : selectedName ? <div className="grid items-start gap-5 lg:grid-cols-4">
      <aside className="min-w-0 space-y-4">
        <Button variant="ghost" className="h-auto whitespace-normal px-0 text-left" onClick={() => { setSelected(''); setSearch(''); }}><ArrowLeft className="size-4 shrink-0" />Back to Warehouse Layout</Button>
        <section className="rounded-2xl border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground">{selectedZone ? 'Selected Zone' : 'Unallocated inventory'}</p><h3 className="mt-2 wrap-break-word text-xl font-bold">{selectedName}</h3><p className="mt-1 wrap-break-word text-sm text-muted-foreground">{warehouse.name}</p>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t pt-4"><div><dt className="text-xs text-muted-foreground">Total products</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{selectedSummary.products.toLocaleString()}</dd></div><div><dt className="text-xs text-muted-foreground">Total units</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{selectedSummary.units.toLocaleString()}</dd></div></dl>
        </section>
        {zones.length > 0 && <nav aria-label="Warehouse zones" className="rounded-2xl border bg-card p-4"><p className="mb-3 text-xs font-medium text-muted-foreground">Zone overview · Not to Scale</p>{floorplan(true)}</nav>}
        {unassignedCard()}
      </aside>
      <section className="min-w-0 overflow-hidden rounded-2xl border bg-card lg:col-span-3">
        <div className="space-y-4 border-b p-5">
          <div><h3 className="wrap-break-word text-lg font-bold">{selectedZone ? `Products Recorded in ${selectedZone.name}` : 'Unassigned Stock'}</h3><p className="mt-1 text-sm text-muted-foreground">{selectedZone ? 'View recorded inventory. Manage stock through inventory allocation or Inventory Movement.' : 'Stock that has not yet been allocated to a zone.'}</p></div>
          <div className="relative"><SearchBar aria-label="Search zone products" placeholder="Search SKU, item, category or supplier..." value={search} onValueChange={setSearch} className="pl-9" /></div>
          {canEdit && zones.length > 0 && selectedProductIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-primary">{selectedProductIds.length} products selected</span>
                <span className="text-muted-foreground">({totalSelectedUnits.toLocaleString()} total units)</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={bulkZoneId} onValueChange={(val) => { if (val !== null) setBulkZoneId(val); }}>
                  <SelectTrigger className="h-9 w-52 bg-card text-xs">
                    <SelectValue placeholder="Choose destination zone">
                      {destinationOptions.find(opt => opt.value === bulkZoneId)?.label || 'Choose destination zone'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {destinationOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" className="h-9 gap-1.5 text-xs" disabled={!bulkZoneId || bulkSaving} onClick={handleBulkAssign}>
                  {bulkSaving ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
                  Assign Selected
                </Button>
                <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => setSelectedProductIds([])}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          aria-hidden="true"
          tabIndex={-1}
          className={
            tableScrollMetrics.overflow
              ? 'w-full overflow-x-auto overflow-y-hidden border-b border-border bg-muted/20'
              : 'hidden'
          }
        >
          <div style={{ width: `${tableScrollMetrics.width}px`, height: '1px' }} />
        </div>
        <div ref={tableWrapperRef}>
        <Table><TableHeader className="bg-muted/40"><TableRow>
          {canEdit && zones.length > 0 && (
            <TableHead className="w-10 pl-4">
              <input
                type="checkbox"
                aria-label="Select all products"
                className="size-4 rounded accent-primary cursor-pointer"
                checked={allVisibleSelected}
                ref={element => { if (element) element.indeterminate = someVisibleSelected; }}
                onChange={e => {
                  if (e.target.checked) setSelectedProductIds(Array.from(new Set([...selectedProductIds, ...rows.map(r => r.id)])));
                  else {
                    const rowIds = new Set(rows.map(r => r.id));
                    setSelectedProductIds(selectedProductIds.filter(pid => !rowIds.has(pid)));
                  }
                }}
              />
            </TableHead>
          )}
          <TableHead className={canEdit && zones.length > 0 ? '' : 'pl-5'}>SKU</TableHead>
          <TableHead>Item Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead className="text-right">{selectedZone ? 'Stock Qty in Zone' : 'Unassigned Qty'}</TableHead>
          {canEdit && <TableHead className="w-36 pr-5 text-right">Actions</TableHead>}
        </TableRow></TableHeader><TableBody>{pagedRows.map(p => {
          const qty = count(p.id, selected);
          const isSelected = selectedProductIdSet.has(p.id);
          return <TableRow key={p.id} className={isSelected ? 'bg-primary/5' : undefined}>
            {canEdit && zones.length > 0 && (
              <TableCell className="w-10 pl-4">
                <input
                  type="checkbox"
                  aria-label={`Select ${p.name}`}
                  className="size-4 rounded accent-primary cursor-pointer"
                  checked={isSelected}
                  onChange={e => {
                    if (e.target.checked) setSelectedProductIds(prev => (prev.includes(p.id) ? prev : [...prev, p.id]));
                    else setSelectedProductIds(prev => prev.filter(pid => pid !== p.id));
                  }}
                />
              </TableCell>
            )}
            <TableCell className={`text-xs font-medium ${canEdit && zones.length > 0 ? '' : 'pl-5'}`}>{p.sku}</TableCell>
            <TableCell className="font-medium">{p.name}</TableCell>
            <TableCell>{p.category || '—'}</TableCell>
            <TableCell>{p.supplier || '—'}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{qty.toLocaleString()}</TableCell>
            {canEdit && (
              <TableCell className="pr-5 text-right">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={zones.length === 0 || qty <= 0}
                  onClick={() => {
                    setAssignTarget({ product: p, currentZoneId: selected, availableQty: qty });
                    setTargetZoneId(selected === 'unassigned' ? (zones[0]?.id || '') : 'unassigned');
                    setAssignQuantity(qty);
                    setAssignError('');
                  }}
                >
                  <ArrowsLeftRight className="size-3.5" />
                  {selected === 'unassigned' ? 'Assign to Zone' : 'Reassign'}
                </Button>
              </TableCell>
            )}
          </TableRow>;
        })}</TableBody></Table>
        </div>
        {!rows.length && <div className="p-12 text-center"><Package className="mx-auto mb-3 size-8 text-muted-foreground/50" /><p className="font-medium">{search ? 'No matching products' : 'No stock recorded here yet'}</p><p className="mt-1 text-sm text-muted-foreground">{search ? 'Try another SKU or item name.' : 'Products appear here when stock is allocated to this location.'}</p></div>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
          <span>
            {totalPages > 1
              ? `Showing ${pageStart + 1}–${Math.min(pageStart + ZONE_TABLE_PAGE_SIZE, rows.length)} of ${rows.length.toLocaleString()} products · Quantities are included in the existing warehouse total.`
              : `${rows.length} products shown · Quantities are included in the existing warehouse total.`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={currentPage <= 1}
                onClick={() => setTablePage(p => Math.max(1, p - 1))}
              >
                <ArrowLeft className="size-3" />
                Prev
              </Button>
              <span className="tabular-nums font-medium text-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={currentPage >= totalPages}
                onClick={() => setTablePage(p => Math.min(totalPages, p + 1))}
              >
                Next
                <ArrowRight className="size-3" />
              </Button>
            </div>
          )}
        </div>
      </section>
    </div> : <>
      <section aria-label="Warehouse Zone Layout" className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-gold/20 p-2.5"><WarehouseIcon className="size-5" /></div><div className="min-w-0"><h3 className="wrap-break-word font-semibold">{warehouse.name}</h3><p className="text-xs text-muted-foreground">Warehouse Zone Layout · {zones.length} zones</p></div></div>
        {floorplan()}
        <p className="mt-5 text-xs text-muted-foreground">Conceptual zones only. This layout does not represent the physical shape or scale of the warehouse.</p>
      </section>
      {unassignedCard()}
    </>}
    <Dialog open={!!editor} onOpenChange={open => { if (!open && !saving) setEditor(null); }}><DialogContent><DialogHeader><DialogTitle>{editor?.mode === 'delete' ? 'Delete zone?' : editor?.mode === 'rename' ? 'Rename zone' : editor?.fromShape ? 'Convert box to inventory zone' : 'Add zone'}</DialogTitle><DialogDescription>{editor?.mode === 'delete' ? `Stock recorded in ${editor.zone?.name} will become Unassigned. Warehouse totals stay the same.` : editor?.fromShape ? 'Creates a trackable inventory zone at this box’s exact position and removes the decorative box.' : 'Create or rename a zone, then arrange it in Edit Layout.'}</DialogDescription></DialogHeader>
      {editor?.mode !== 'delete' && <div className="space-y-2"><Label htmlFor="zone-name">Zone name</Label><Input id="zone-name" autoFocus maxLength={60} value={name} onChange={e => setName(e.target.value)} /></div>}{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => setEditor(null)}>Cancel</Button><Button disabled={saving || (editor?.mode !== 'delete' && !name.trim())} variant={editor?.mode === 'delete' ? 'destructive' : 'default'} onClick={saveZone}>{saving ? 'Saving…' : editor?.mode === 'delete' ? 'Delete zone' : editor?.fromShape ? 'Convert to Zone' : 'Save zone'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={!!assignTarget} onOpenChange={open => { if (!open && !assignSaving) setAssignTarget(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{assignTarget?.currentZoneId === 'unassigned' ? 'Assign Stock to Zone' : 'Reassign Stock Location'}</DialogTitle><DialogDescription>{assignTarget?.product.name} ({assignTarget?.product.sku})</DialogDescription></DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3.5 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Current location:</span><span className="font-medium">{assignTarget?.currentZoneId === 'unassigned' ? 'Unassigned Stock' : (zones.find(z => z.id === assignTarget?.currentZoneId)?.name || 'Zone')}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Available units:</span><span className="font-semibold tabular-nums">{assignTarget?.availableQty.toLocaleString()} units</span></div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="target-zone-select">Destination zone</Label>
          <Select value={targetZoneId} onValueChange={(val) => { if (val !== null) setTargetZoneId(val); }}>
            <SelectTrigger id="target-zone-select" className="w-full bg-card">
              <SelectValue placeholder="Choose destination">
                {targetZoneId === 'unassigned' ? 'Unassigned Stock (Return to unallocated)' : (zones.find(z => z.id === targetZoneId)?.name || 'Choose destination')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {assignTarget?.currentZoneId !== 'unassigned' && (
                <SelectItem value="unassigned">Unassigned Stock (Return to unallocated)</SelectItem>
              )}
              {zones.filter(z => z.id !== assignTarget?.currentZoneId).map(z => {
                const currentInZone = count(assignTarget?.product.id || '', z.id);
                return (
                  <SelectItem key={z.id} value={z.id}>
                    {z.name} {currentInZone > 0 ? `(${currentInZone.toLocaleString()} already recorded)` : ''}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="assign-qty-input">Quantity to Move</Label>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs font-medium text-primary" onClick={() => setAssignQuantity(assignTarget?.availableQty || 0)}>
              Max ({assignTarget?.availableQty.toLocaleString()})
            </Button>
          </div>
          <Input
            id="assign-qty-input"
            type="number"
            min={1}
            max={assignTarget?.availableQty || 1}
            value={assignQuantity || ''}
            onChange={e => {
              const val = parseInt(e.target.value, 10);
              setAssignQuantity(isNaN(val) ? 0 : Math.min(assignTarget?.availableQty || 0, Math.max(0, val)));
            }}
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Remaining at current location:</span>
            <span className="font-medium tabular-nums">{Math.max(0, (assignTarget?.availableQty || 0) - assignQuantity).toLocaleString()} units</span>
          </div>
        </div>
        {assignError && <p role="alert" className="text-xs text-destructive">{assignError}</p>}
      </div>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" disabled={assignSaving} onClick={() => setAssignTarget(null)}>Cancel</Button>
        <Button disabled={assignSaving || !targetZoneId || assignQuantity <= 0 || assignQuantity > (assignTarget?.availableQty || 0)} onClick={handleSingleAssign}>
          {assignSaving && <Loader2 className="size-4 animate-spin" />}
          {assignSaving ? 'Moving…' : `Move ${assignQuantity.toLocaleString()} Units`}
        </Button>
      </DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={clearConfirmOpen} onOpenChange={open => { if (!open && !clearingMap) setClearConfirmOpen(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{zones.length > 0 ? 'Clear all zones on map?' : 'Clear floorplan layout?'}</DialogTitle>
          <DialogDescription>
            {zones.length > 0
              ? `This removes all ${zones.length} zones in ${warehouse?.name || 'this warehouse'} and resets the floorplan to an empty map. Existing stock quantities stay intact and return to Unassigned Stock.`
              : `This clears all drawn shapes, labels, lines, and doors in ${warehouse?.name || 'this warehouse'} and resets the floorplan to an empty map.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={clearingMap} onClick={() => setClearConfirmOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={clearingMap} onClick={handleClearMap}>
            {clearingMap && <Loader2 className="size-4 animate-spin" />}
            {clearingMap ? 'Clearing…' : 'Clear Map'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!pendingLeaveAction} onOpenChange={open => { if (!open) setPendingLeaveAction(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {pendingLeaveAction?.kind === 'add-warehouse' ? 'Leave Warehouse Layout with unsaved edits?' : 'Switch warehouse with unsaved edits?'}
          </DialogTitle>
          <DialogDescription>
            You have unsaved floorplan changes in {warehouse?.name || 'this warehouse'}. Leaving now will keep a local recovery draft, or you can stay and save first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setPendingLeaveAction(null)}>Stay Here</Button>
          <Button
            variant="destructive"
            onClick={() => {
              const target = pendingLeaveAction;
              setPendingLeaveAction(null);
              if (target?.kind === 'warehouse') setWarehouseId(target.id);
              else if (target?.kind === 'add-warehouse') navigate('/supply-chain?view=warehouses&action=add');
            }}
          >
            {pendingLeaveAction?.kind === 'add-warehouse' ? 'Go to Add Warehouse' : 'Switch Warehouse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
