import { hasAdminRole } from '../lib/staffPermissions';
import { useStaffAccess } from '../hooks/useStaffAccess';
import { permitsMovement } from '../lib/staffPermissions';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowRightLeft, Check, CheckCircle2, ChevronLeft, Clock3, Eye, History, Loader2, Package, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { collection, db, onSnapshot } from '../lib/supabaseAdapter';
import { availableStock, newMovementDraft, purchaseTotal, validateMovement, type InventoryMovementRecord, type MovementDraft, type MovementLine } from '../lib/inventoryMovement';
import type { InventoryItem, Product, Warehouse } from '../types';
import { Transfers } from './Transfers';
import { zoneQuantity, type WarehouseZone, type ZoneAllocation } from '../lib/warehouseLayout';

const money = (amount: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
const dateTime = (date: string) => new Date(date).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
type Option = { id: string; name: string };

function Choice({ id, label, value, onChange, options, placeholder = 'Select an option' }: {
  id: string; label: string; value: string; onChange: (value: string) => void; options: Option[]; placeholder?: string;
}) {
  return <div className="space-y-2"><Label htmlFor={id} className="text-xs font-semibold">{label}</Label>
    <Select value={value} onValueChange={value => onChange(value ?? '')}>
      <SelectTrigger id={id} className="w-full h-10! rounded-lg bg-background"><SelectValue placeholder={placeholder}>{options.find(option => option.id === value)?.name || placeholder}</SelectValue></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}

function TypeBadge({ external }: { external: boolean }) {
  return <Badge variant="outline" className={external ? 'gap-1.5 border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300' : 'gap-1.5 border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300'}>
    {external ? <ArrowDownToLine className="size-3" /> : <ArrowRightLeft className="size-3" />}{external ? 'External' : 'Internal'}
  </Badge>;
}

function ItemsSummary({ items, external }: { items: MovementLine[]; external: boolean }) {
  return <div className="overflow-hidden rounded-xl border"><Table><TableHeader className="bg-muted/50"><TableRow>
    <TableHead>Product</TableHead><TableHead className="text-right">Quantity</TableHead>{external && <><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Subtotal</TableHead></>}
  </TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.productId}>
    <TableCell><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.sku}</p></TableCell><TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
    {external && <><TableCell className="text-right tabular-nums">{money(item.unitCost)}</TableCell><TableCell className="text-right font-medium tabular-nums">{money(purchaseTotal([item]))}</TableCell></>}
  </TableRow>)}</TableBody></Table></div>;
}

export function InventoryMovement() {
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [zoneAllocations, setZoneAllocations] = useState<ZoneAllocation[]>([]);
  const [zonesReady, setZonesReady] = useState(false);
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [referenceErrors, setReferenceErrors] = useState<Record<string, string>>({});
  const [loadedReferences, setLoadedReferences] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [legacy, setLegacy] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'details' | 'review'>('details');
  const [draft, setDraft] = useState<MovementDraft>(newMovementDraft);
  const [productSearch, setProductSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestId = useRef('');
  const [selected, setSelected] = useState<InventoryMovementRecord | null>(null);
  const canManage = permissions.movementCreate !== 'none';
  const ready = loadedReferences.length === 4 && !Object.keys(referenceErrors).length;

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    const stop = onSnapshot(collection(db, 'inventory_movements'), snap => {
      setMovements(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ ...d.data(), id: d.id } as InventoryMovementRecord)).filter((movement: InventoryMovementRecord) => permitsMovement(permissions.movementView, movement.type)));
      setLoading(false);
      setLoadError('');
    }, () => { setLoading(false); setLoadError('Movement history could not be loaded. Please retry or contact your administrator.'); });
    return stop;
  }, [reload]);

  useEffect(() => {
    const watch = <T,>(table: string, update: (value: T[]) => void) => onSnapshot(collection(db, table), snap => {
      update(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ ...d.data(), id: d.id } as T)));
      setLoadedReferences(prev => [...new Set([...prev, table])]);
      setReferenceErrors(prev => { const next = { ...prev }; delete next[table]; return next; });
    }, () => setReferenceErrors(prev => ({ ...prev, [table]: `Unable to load ${table}.` })));
    const stops = [watch('products', setProducts), watch('warehouses', setWarehouses), watch('suppliers', setSuppliers), watch('inventory', setInventory)];
    return () => stops.forEach(stop => stop());
  }, [reload]);

  const external = draft.type === 'external';
  useEffect(() => {
    let active = true;
    setZonesReady(false);
    void Promise.all([supabase.from('warehouse_zones').select('*'), supabase.from('warehouse_zone_allocations').select('*')]).then(([z, a]) => {
      if (!active) return;
      if (!z.error && !a.error) { setZones(z.data as WarehouseZone[]); setZoneAllocations(a.data as ZoneAllocation[]); setZonesReady(true); }
    });
    return () => { active = false; };
  }, [open, reload]);
  const sourceStock = (productId: string) => zonesReady
    ? zoneQuantity(zoneAllocations, inventory, draft.sourceWarehouseId, productId, draft.sourceZoneId || 'unassigned')
    : availableStock(inventory, productId, draft.sourceWarehouseId);
  const zoneOptions = (warehouseId: string) => [{ id: 'unassigned', name: 'Unassigned' }, ...zones.filter(z => z.warehouseId === warehouseId).sort((a, b) => a.sortOrder - b.sortOrder).map(z => ({ id: z.id, name: z.name }))];
  const total = purchaseTotal(draft.items);
  const units = draft.items.reduce((sum, item) => sum + item.quantity, 0);
  const warehouseName = (id: string) => warehouses.find(warehouse => warehouse.id === id)?.name || 'Unknown warehouse';
  const supplierName = suppliers.find(supplier => supplier.id === draft.supplierId)?.name || 'Select a supplier';
  const activeWarehouses = warehouses.filter(warehouse => warehouse.active !== false);
  const filtered = movements.filter(movement => {
    const haystack = [movement.movementNumber, movement.supplierName, movement.sourceWarehouseName, movement.destinationWarehouseName, movement.invoiceNumber, movement.driverName, movement.vehiclePlate, movement.recordedByName, ...movement.items.flatMap(item => [item.name, item.sku])].join(' ').toLowerCase();
    return haystack.includes(search.toLowerCase().trim()) && (typeFilter === 'all' || movement.type === typeFilter)
      && (warehouseFilter === 'all' || movement.sourceWarehouseId === warehouseFilter || movement.destinationWarehouseId === warehouseFilter)
      && (supplierFilter === 'all' || movement.supplierId === supplierFilter)
      && (statusFilter === 'all' || movement.status === statusFilter);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const matchingProducts = products.filter(product => `${product.name} ${product.sku}`.toLowerCase().includes(productSearch.trim().toLowerCase()));
  const updateDraft = (patch: Partial<MovementDraft>) => { setDraft(prev => ({ ...prev, ...patch,
    sourceZoneId: patch.sourceWarehouseId !== undefined || patch.type !== undefined ? '' : patch.sourceZoneId ?? prev.sourceZoneId,
    destinationZoneId: patch.destinationWarehouseId !== undefined ? '' : patch.destinationZoneId ?? prev.destinationZoneId,
  })); setFormError(''); };
  const updateLine = (id: string, patch: Partial<MovementLine>) => updateDraft({ items: draft.items.map(item => item.productId === id ? { ...item, ...patch } : item) });

  function startMovement() {
    setDraft({ ...newMovementDraft(), type: permissions.movementCreate === 'internal' ? 'internal' : 'external' }); setStep('details'); setProductSearch(''); setFormError('');
    requestId.current = crypto.randomUUID(); setOpen(true);
  }

  function addProduct(product: Product) {
    const existing = draft.items.find(item => item.productId === product.id);
    if (existing) updateLine(product.id, { quantity: existing.quantity + 1 });
    else updateDraft({ items: [...draft.items, { productId: product.id, name: product.name, sku: product.sku, quantity: 1, unitCost: Number(product.costPrice) || 0 }] });
  }

  function review() {
    const error = validateMovement(draft, inventory);
    if (error) { setFormError(error); return; }
    if (!external && zonesReady && draft.items.some(item => item.quantity > sourceStock(item.productId))) { setFormError('Not enough stock in the selected source zone. Choose another zone or update its allocations.'); return; }
    setFormError(''); setStep('review');
  }

  async function confirm() {
    if (savingRef.current || !canManage || !ready || !permitsMovement(permissions.movementCreate, draft.type)) return;
    const error = validateMovement(draft, inventory);
    if (error) { setFormError(error); setStep('details'); return; }
    savingRef.current = true; setSaving(true); setFormError('');
    try {
      const { data, error: saveError } = await supabase.rpc(zonesReady ? 'confirm_inventory_movement_with_zones' : 'confirm_inventory_movement', {
        p_request_id: requestId.current,
        p_movement: { ...draft, supplierId: external ? draft.supplierId : null, sourceWarehouseId: external ? null : draft.sourceWarehouseId,
          invoiceNumber: external ? draft.invoiceNumber.trim() : '', driverName: external ? '' : draft.driverName.trim(), vehiclePlate: external ? '' : draft.vehiclePlate.trim().toUpperCase(),
          items: draft.items.map(item => ({ productId: item.productId, quantity: item.quantity, unitCost: external ? item.unitCost : 0 })) },
      });
      if (saveError) throw saveError;
      const saved = data as InventoryMovementRecord;
      setMovements(prev => [saved, ...prev.filter(item => item.id !== saved.id)]);
      setOpen(false); setSelected(saved);
      toast.success(`${saved.movementNumber} confirmed`, { description: external ? 'Inventory received and purchase expense recorded.' : 'Stock moved to the destination warehouse.' });
    } catch (error) {
      const message = (error as { message?: string }).message || 'Unable to confirm movement. Please try again.';
      setFormError(/function|schema cache/i.test(message) ? 'Movement confirmation is not available yet. Contact your administrator to finish setting up Inventory Movement.' : message);
    } finally { savingRef.current = false; setSaving(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-2xl font-bold tracking-tight">Inventory Movement</h1><p className="mt-1 text-sm text-muted-foreground">Receive supplier purchases and move stock between your warehouses.</p></div>
      {canManage && <Button onClick={startMovement} disabled={!ready} className="h-11 rounded-xl px-5"><Plus className="size-4" /> New Movement</Button>}
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      {[
        { label: 'External receipts', value: movements.filter(m => m.type === 'external').length.toLocaleString(), note: 'Supplier purchases received', icon: ArrowDownToLine, style: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300' },
        { label: 'Internal transfers', value: movements.filter(m => m.type === 'internal').length.toLocaleString(), note: 'Completed warehouse transfers', icon: ArrowRightLeft, style: 'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-300' },
        { label: 'Total purchase value', value: money(movements.reduce((sum, m) => sum + Number(m.totalValue || 0), 0)), note: 'External receipts · all time', icon: Package, style: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300' },
      ].map(stat => <div key={stat.label} className="flex items-start gap-4 rounded-xl border bg-card p-5"><div className={`rounded-xl p-2.5 ${stat.style}`}><stat.icon className="size-5" /></div><div><p className="text-xs font-medium text-muted-foreground">{stat.label}</p><p className="mt-1 text-2xl font-semibold tracking-tight">{loading || loadError ? '—' : stat.value}</p><p className="mt-1 text-xs text-muted-foreground">{stat.note}</p></div></div>)}
    </div>

    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" /> Movement history</h2>{(hasAdminRole(profile) || profile?.role === 'secretary') && <Button variant="ghost" size="sm" onClick={() => setLegacy(!legacy)}>{legacy ? 'Back to movements' : 'Earlier transport records'}<ArrowRight className="size-3.5" /></Button>}</div>
    {legacy ? <div className="space-y-4"><div className="rounded-xl border bg-muted/40 p-4 text-sm"><p className="font-semibold">Earlier transport records</p><p className="mt-1 text-muted-foreground">View and complete transport requests created before Inventory Movement. Their original IDs and statuses are preserved.</p></div><Transfers historyOnly /></div> : <>
      {(loadError || Object.keys(referenceErrors).length > 0) && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><span>{loadError || Object.values(referenceErrors).join(' ')}</span><Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>Retry</Button></div>}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="space-y-4 border-b p-4"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search movements" className="h-10 pl-9" placeholder="Search movement ID, product, SKU, supplier, or invoice…" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <Choice id="filter-type" label="Movement type" value={typeFilter} onChange={setTypeFilter} options={[{ id: 'all', name: 'All types' }, { id: 'external', name: 'External receipt' }, { id: 'internal', name: 'Internal transfer' }]} />
            <Choice id="filter-warehouse" label="Warehouse" value={warehouseFilter} onChange={setWarehouseFilter} options={[{ id: 'all', name: 'All warehouses' }, ...warehouses]} />
            <Choice id="filter-supplier" label="Supplier" value={supplierFilter} onChange={setSupplierFilter} options={[{ id: 'all', name: 'All suppliers' }, ...suppliers]} />
            <Choice id="filter-status" label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ id: 'all', name: 'All statuses' }, { id: 'confirmed', name: 'Confirmed' }]} />
            <Button variant="ghost" className="h-10" onClick={() => { setSearch(''); setTypeFilter('all'); setWarehouseFilter('all'); setSupplierFilter('all'); setStatusFilter('all'); }}>Reset filters</Button>
          </div>
        </div>
        <Table><TableHeader className="bg-muted/40"><TableRow>{['Movement ID', 'Type', 'Supplier / Source', 'Warehouse / Destination', 'Items', 'Total Value', 'Status', 'Date & Time', 'Recorded By', 'Actions'].map(label => <TableHead key={label} className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wide">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{filtered.map(movement => <TableRow key={movement.id}>
            <TableCell><button className="whitespace-nowrap font-mono text-xs font-semibold hover:underline focus-visible:outline-2" onClick={() => setSelected(movement)}>{movement.movementNumber}</button></TableCell><TableCell><TypeBadge external={movement.type === 'external'} /></TableCell>
            <TableCell className="min-w-36 text-sm">{movement.type === 'external' ? movement.supplierName : movement.sourceWarehouseName}</TableCell><TableCell className="min-w-36 text-sm">{movement.destinationWarehouseName}</TableCell>
            <TableCell className="whitespace-nowrap"><p className="text-sm">{movement.items.reduce((sum, item) => sum + item.quantity, 0)} units</p><p className="text-xs text-muted-foreground">{movement.items.length} product{movement.items.length === 1 ? '' : 's'}</p></TableCell>
            <TableCell className="whitespace-nowrap font-medium tabular-nums">{movement.type === 'external' ? money(Number(movement.totalValue)) : '—'}</TableCell><TableCell><Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><Check className="size-3" />Confirmed</Badge></TableCell>
            <TableCell className="min-w-36 text-xs">{dateTime(movement.createdAt)}</TableCell><TableCell className="min-w-28 text-sm">{movement.recordedByName}</TableCell><TableCell><Button variant="ghost" size="icon" aria-label={`View ${movement.movementNumber}`} onClick={() => setSelected(movement)}><Eye className="size-4" /></Button></TableCell>
          </TableRow>)}{(loading || loadError || !filtered.length) && <TableRow><TableCell colSpan={10} className="h-52 text-center"><div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-muted-foreground">{loading ? <Loader2 className="size-6 animate-spin" /> : <Package className="size-8 opacity-40" />}<p className="font-medium text-foreground">{loading ? 'Loading movements…' : loadError ? 'History unavailable' : movements.length ? 'No matching movements' : 'Your movement history starts here'}</p><p className="text-xs">{loading ? 'Getting your latest records.' : loadError ? 'Retry loading your movement history.' : movements.length ? 'Try a different search or reset your filters.' : 'Create a receipt or transfer to keep every stock movement in one place.'}</p>{!loading && !loadError && !movements.length && canManage && <Button variant="outline" size="sm" disabled={!ready} onClick={startMovement} className="mt-2"><Plus className="size-3" />Create first movement</Button>}</div></TableCell></TableRow>}</TableBody>
        </Table><div className="flex flex-wrap justify-between gap-2 border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground"><span>Showing {filtered.length} of {movements.length} movements</span><span>Dates shown in Philippine time</span></div>
      </div>
    </>}

    <Dialog open={open && canManage} onOpenChange={value => { if (!savingRef.current) setOpen(value); }}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl" showCloseButton={!saving}>
        <DialogHeader className="shrink-0 border-b px-6 py-5"><DialogTitle className="text-xl font-semibold">{step === 'review' ? 'Review movement' : 'New Inventory Movement'}</DialogTitle><DialogDescription>{step === 'review' ? 'Check the details and stock changes before confirming.' : 'Choose a movement type, add products, and review before saving.'}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {step === 'details' ? <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2">{(['external', 'internal'] as const).filter(type => permitsMovement(permissions.movementCreate, type)).map(type => <button key={type} type="button" aria-pressed={draft.type === type} onClick={() => updateDraft({ type })} className={`flex gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 ${draft.type === type ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}><div className="rounded-lg bg-background p-2 h-fit">{type === 'external' ? <ArrowDownToLine className="size-5" /> : <ArrowRightLeft className="size-5" />}</div><div className="flex-1"><p className="font-semibold">{type === 'external' ? 'External Receipt' : 'Internal Transfer'}</p><p className="mt-1 text-xs text-muted-foreground">{type === 'external' ? 'Receive a supplier purchase into inventory.' : 'Move existing stock between warehouses.'}</p></div><span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${draft.type === type ? 'border-primary bg-primary text-primary-foreground' : ''}`}>{draft.type === type && <Check className="size-3" />}</span></button>)}</div>
            <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
              <div className="space-y-6">
                <section className="space-y-4"><h3 className="text-sm font-semibold">01 / {external ? 'Receipt details' : 'Transfer route'}</h3><div className="grid gap-4 sm:grid-cols-2">
                  {external ? <Choice id="movement-supplier" label="Supplier *" value={draft.supplierId} onChange={supplierId => updateDraft({ supplierId })} options={suppliers} placeholder="Select supplier" /> : <Choice id="movement-source" label="Source warehouse *" value={draft.sourceWarehouseId} onChange={sourceWarehouseId => updateDraft({ sourceWarehouseId })} options={activeWarehouses} placeholder="Select source" />}
                  <Choice id="movement-destination" label={external ? 'Receiving warehouse *' : 'Destination warehouse *'} value={draft.destinationWarehouseId} onChange={destinationWarehouseId => updateDraft({ destinationWarehouseId })} options={activeWarehouses.filter(warehouse => external || warehouse.id !== draft.sourceWarehouseId)} placeholder={external ? 'Select receiving warehouse' : 'Select destination'} />
                  {zonesReady && <>{!external && <Choice id="movement-source-zone" label="Source zone (optional)" value={draft.sourceZoneId || 'unassigned'} onChange={sourceZoneId => updateDraft({ sourceZoneId: sourceZoneId === 'unassigned' ? '' : sourceZoneId })} options={zoneOptions(draft.sourceWarehouseId)} />}<Choice id="movement-destination-zone" label="Destination zone (optional)" value={draft.destinationZoneId || 'unassigned'} onChange={destinationZoneId => updateDraft({ destinationZoneId: destinationZoneId === 'unassigned' ? '' : destinationZoneId })} options={zoneOptions(draft.destinationWarehouseId)} /></>}
                  {external ? <div className="space-y-2 sm:col-span-2"><Label htmlFor="movement-invoice" className="text-xs font-semibold">Invoice number *</Label><Input id="movement-invoice" placeholder="e.g. INV-2026-001" value={draft.invoiceNumber} onChange={event => updateDraft({ invoiceNumber: event.target.value })} /></div> : <><div className="space-y-2"><Label htmlFor="movement-driver" className="text-xs font-semibold">Driver name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="movement-driver" placeholder="Driver's full name" value={draft.driverName} onChange={event => updateDraft({ driverName: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="movement-plate" className="text-xs font-semibold">Vehicle plate <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="movement-plate" placeholder="e.g. ABC 1234" value={draft.vehiclePlate} onChange={event => updateDraft({ vehiclePlate: event.target.value.toUpperCase() })} /></div></>}
                </div>{external && !suppliers.length && <p className="text-xs text-amber-700">Add a supplier in Inventory before recording a receipt.</p>}</section>
                <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">02 / Products & quantities</h3><span className="text-xs text-muted-foreground">{draft.items.length} selected</span></div>
                  <div className="overflow-hidden rounded-xl border"><div className="relative border-b"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Find products to add" className="h-10 rounded-none border-0 pl-9 shadow-none" placeholder="Search product name or SKU…" value={productSearch} onChange={event => setProductSearch(event.target.value)} /></div><div className="max-h-44 overflow-y-auto divide-y">
                    {matchingProducts.slice(0, 40).map(product => { const stock = sourceStock(product.id); const added = draft.items.find(item => item.productId === product.id)?.quantity || 0; const disabled = !external && (!draft.sourceWarehouseId || stock <= added); return <div key={product.id} className="flex items-center gap-3 px-3 py-2.5"><div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">{product.photoUrl ? <img src={product.photoUrl} alt="" className="size-full object-cover" /> : <Package className="size-4 text-muted-foreground" />}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{product.name}</p><p className="text-[11px] text-muted-foreground">{product.sku}{!external && draft.sourceWarehouseId && <span className={stock === 0 ? 'text-destructive' : ''}> · {stock} available</span>}</p></div><Button variant="outline" size="sm" disabled={disabled} aria-label={`Add ${product.name}`} onClick={() => addProduct(product)}><Plus className="size-3" />Add</Button></div>; })}
                    {!matchingProducts.length && <p className="p-6 text-center text-xs text-muted-foreground">No products found. Try another name or SKU.</p>}
                    {matchingProducts.length > 40 && <p className="p-2 text-center text-xs text-muted-foreground">Search to narrow down {matchingProducts.length} products.</p>}
                  </div></div>
                  {!external && !draft.sourceWarehouseId && <p className="text-xs text-muted-foreground">Select a source warehouse to see available stock and add products.</p>}
                  {draft.items.length > 0 ? <div className="space-y-2">{draft.items.map(item => { const stock = sourceStock(item.productId); const insufficient = !external && item.quantity > stock; return <div key={item.productId} className={`rounded-xl border p-3 ${insufficient ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/20'}`}><div className="mb-2 flex items-start justify-between gap-2"><div><p className="text-xs font-semibold">{item.name}</p><p className="text-[11px] text-muted-foreground">{item.sku}</p></div><Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.name}`} onClick={() => updateDraft({ items: draft.items.filter(line => line.productId !== item.productId) })}><Trash2 className="size-3.5 text-muted-foreground" /></Button></div><div className="flex flex-wrap items-end gap-3"><div className="w-24 space-y-1"><Label htmlFor={`qty-${item.productId}`} className="text-[11px]">Quantity</Label><Input id={`qty-${item.productId}`} type="number" min="1" step="1" className="h-8" value={Number.isNaN(item.quantity) ? '' : item.quantity} onChange={event => updateLine(item.productId, { quantity: event.target.valueAsNumber })} /></div>{external ? <><div className="w-28 space-y-1"><Label htmlFor={`cost-${item.productId}`} className="text-[11px]">Unit cost (₱)</Label><Input id={`cost-${item.productId}`} type="number" min="0.01" step="0.01" className="h-8" value={Number.isNaN(item.unitCost) ? '' : item.unitCost} onChange={event => updateLine(item.productId, { unitCost: event.target.valueAsNumber })} /></div><p className="ml-auto pb-1 text-sm font-semibold tabular-nums">{Number.isFinite(purchaseTotal([item])) ? money(purchaseTotal([item])) : '—'}</p></> : <p className={`pb-1 text-xs ${insufficient ? 'text-destructive' : 'text-muted-foreground'}`}>{stock} available{insufficient ? ' · Not enough stock' : ''}</p>}</div></div>; })}</div> : <div className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">Add products above to build your movement.</div>}
                </section>
                <div className="space-y-2"><Label htmlFor="movement-notes" className="text-xs font-semibold">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label><textarea id="movement-notes" rows={3} className="w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Add any details about this movement…" value={draft.notes} onChange={event => updateDraft({ notes: event.target.value })} /></div>
              </div>
              <aside className="h-fit space-y-5 rounded-xl border bg-muted/25 p-5 lg:sticky lg:top-0"><h3 className="text-sm font-semibold">Movement summary</h3><TypeBadge external={external} /><div className="space-y-3 text-xs"><div className="flex justify-between gap-3"><span className="text-muted-foreground">Products</span><span>{draft.items.length}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">Total units</span><span>{Number.isFinite(units) ? units : '—'}</span></div><div className="border-t pt-3"><p className="text-muted-foreground">{external ? 'Purchase value' : 'Purchase expense'}</p><p className="mt-1 text-2xl font-semibold">{external ? Number.isFinite(total) ? money(total) : '—' : 'None'}</p></div></div><p className="rounded-lg bg-background p-3 text-xs leading-relaxed text-muted-foreground">{external ? 'Confirmation adds stock to the receiving warehouse and records this total as a purchase expense.' : 'Confirmation deducts stock from the source and adds it to the destination. No purchase expense is recorded.'}</p><div className="space-y-3 border-t pt-4 text-xs"><p className="flex items-center gap-2"><UserRound className="size-3.5 text-muted-foreground" />{profile?.displayName || profile?.email}</p><p className="flex items-start gap-2 text-muted-foreground"><Clock3 className="mt-0.5 size-3.5 shrink-0" />Movement ID and date/time are assigned automatically on confirmation.</p></div></aside>
            </div>
          </div> : <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><TypeBadge external={external} /><span className="text-xs text-muted-foreground">{draft.items.length} products · {units} units</span></div><div className="grid gap-4 rounded-xl border bg-muted/20 p-5 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">{external ? 'Supplier' : 'Source warehouse'}</p><p className="mt-1 font-semibold">{external ? supplierName : warehouseName(draft.sourceWarehouseId)}</p></div><div><p className="text-xs text-muted-foreground">{external ? 'Receiving warehouse' : 'Destination warehouse'}</p><p className="mt-1 font-semibold">{warehouseName(draft.destinationWarehouseId)}</p></div>{external ? <div><p className="text-xs text-muted-foreground">Invoice number</p><p className="mt-1 font-medium">{draft.invoiceNumber}</p></div> : (draft.driverName || draft.vehiclePlate) && <div><p className="text-xs text-muted-foreground">Transport details</p><p className="mt-1">{[draft.driverName, draft.vehiclePlate].filter(Boolean).join(' · ')}</p></div>}<div><p className="text-xs text-muted-foreground">Recorded by</p><p className="mt-1 font-medium">{profile?.displayName || profile?.email}</p></div></div><ItemsSummary items={draft.items} external={external} />{draft.notes.trim() && <div><p className="mb-1 text-xs text-muted-foreground">Notes</p><p className="whitespace-pre-wrap wrap-break-word text-sm">{draft.notes}</p></div>}<div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900 dark:bg-emerald-950/30"><h3 className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4 text-emerald-600" />What happens on confirmation</h3><p className="mt-2 text-sm">{external ? `${units} units will be added to ${warehouseName(draft.destinationWarehouseId)}. A purchase expense of ${money(total)} will be recorded.` : `${units} units will be deducted from ${warehouseName(draft.sourceWarehouseId)} and added to ${warehouseName(draft.destinationWarehouseId)}.`}</p><p className="mt-2 text-xs text-muted-foreground">A unique Movement ID and system date/time will be saved with this record. Confirmed movements cannot be edited here.</p></div></div>}
        </div>
        {step === 'review' && zonesReady && <div className="border-t bg-muted/20 px-6 py-3 text-xs text-muted-foreground">{!external && <>Source zone: <strong>{zones.find(z => z.id === draft.sourceZoneId)?.name || 'Unassigned'}</strong> · </>}Destination zone: <strong>{zones.find(z => z.id === draft.destinationZoneId)?.name || 'Unassigned'}</strong></div>}
        {formError && <div role="alert" className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-6 py-3 text-sm text-destructive">{formError}</div>}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-6 py-4"><p className="text-xs text-muted-foreground">{step === 'details' ? '* Required fields' : 'Review complete? Confirm to update inventory.'}</p><div className="flex gap-2"><Button variant="outline" disabled={saving} onClick={() => step === 'review' ? setStep('details') : setOpen(false)}>{step === 'review' ? <><ChevronLeft className="size-4" />Back to edit</> : 'Cancel'}</Button><Button disabled={saving || !ready || !canManage || !draft.items.length} onClick={step === 'details' ? review : confirm}>{saving ? <><Loader2 className="size-4 animate-spin" />Confirming…</> : step === 'details' ? <>Review movement<ArrowRight className="size-4" /></> : <><Check className="size-4" />Confirm {external ? 'receipt' : 'transfer'}</>}</Button></div></div>
      </DialogContent>
    </Dialog>

    <Dialog open={!!selected} onOpenChange={value => { if (!value) setSelected(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle className="font-mono text-lg">{selected?.movementNumber}</DialogTitle><DialogDescription>Movement details and confirmation history</DialogDescription></DialogHeader>{selected && <div className="space-y-5"><div className="flex items-center justify-between"><TypeBadge external={selected.type === 'external'} /><Badge variant="outline" className="text-emerald-600"><Check className="mr-1 size-3" />Confirmed</Badge></div><dl className="grid gap-4 rounded-xl bg-muted/30 p-4 sm:grid-cols-2">{[
      [selected.type === 'external' ? 'Supplier' : 'Source warehouse', selected.type === 'external' ? selected.supplierName : selected.sourceWarehouseName],
      [selected.type === 'external' ? 'Receiving warehouse' : 'Destination warehouse', selected.destinationWarehouseName],
      ...(selected.sourceZoneName ? [['Source zone', selected.sourceZoneName]] : []),
      ...(selected.destinationZoneName ? [['Destination zone', selected.destinationZoneName]] : []),
      ['Recorded by', selected.recordedByName], ['Date & time (Philippines)', dateTime(selected.createdAt)],
      ...(selected.type === 'external' ? [['Invoice number', selected.invoiceNumber], ['Purchase expense', money(Number(selected.totalValue))]] : [['Driver name', selected.driverName || '—'], ['Vehicle plate', selected.vehiclePlate || '—']]),
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 wrap-break-word text-sm font-medium">{value}</dd></div>)}</dl><ItemsSummary items={selected.items} external={selected.type === 'external'} />{selected.type === 'external' && <p className="text-right font-semibold">Total purchase value: {money(Number(selected.totalValue))}</p>}{selected.notes && <div><p className="text-xs text-muted-foreground">Notes</p><p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm">{selected.notes}</p></div>}<div className="border-t pt-4"><h3 className="mb-3 text-sm font-semibold">History</h3><div className="flex gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /><div><p className="text-sm font-medium">Movement confirmed by {selected.recordedByName}</p><p className="mt-1 text-xs text-muted-foreground">{dateTime(selected.createdAt)}</p><p className="mt-2 text-xs text-muted-foreground">{selected.type === 'external' ? 'Inventory received and purchase expense recorded.' : 'Source stock deducted and destination stock received. No purchase expense.'}</p></div></div></div><div className="flex justify-end"><Button variant="outline" onClick={() => setSelected(null)}>Close details</Button></div></div>}</DialogContent></Dialog>
  </div>;
}
