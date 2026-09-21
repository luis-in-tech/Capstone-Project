import { useEffect, useState } from 'react';
import { WarehouseFloorplan } from './WarehouseFloorplan';
import { ArrowLeft, Grid2X2, Info, Loader2, Package, Search, Warehouse as WarehouseIcon } from 'lucide-react';
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
import { localLayoutKey, readLocalLayout, validLocalAllocations } from '../lib/warehouseLayoutLocal';
import { supabase } from '../lib/supabase';
import { zoneQuantity, type WarehouseZone, type ZoneAllocation } from '../lib/warehouseLayout';
import type { Product, InventoryItem, Warehouse } from '../types';

export function WarehouseLayout({ warehouses, products, inventory }: { warehouses: Warehouse[]; products: Product[]; inventory: InventoryItem[] }) {
  const access = useStaffAccess();
  const { profile } = useAuth();
  const [temporary, setTemporary] = useState(false);
  const allowed = warehouses.filter(w => access.permissions.warehouseAccess === 'all' || access.permissions.warehouseIds.includes(w.id));
  const [warehouseId, setWarehouseId] = useState('');
  const warehouse = allowed.find(w => w.id === warehouseId) || allowed[0];
  const id = warehouse?.id || '';
  const storageKey = localLayoutKey(import.meta.env.VITE_SUPABASE_URL || '', profile?.uid || '', id);
  const canEdit = access.permissions.inventory === 'adjust' && !access.loading && !access.error && !access.revoked && !!id;
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [allocations, setAllocations] = useState<ZoneAllocation[]>([]);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ mode: 'add' | 'rename' | 'delete'; zone?: WarehouseZone } | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => { setSelected(''); setSearch(''); setEditor(null); setLoading(true); setZones([]); setAllocations([]); setTemporary(false); }, [id, storageKey]);
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
        if (failures.length && failures.every(({ error }) => ['PGRST205', '42P01'].includes(error.code))) {
          const saved = readLocalLayout(localStorage, storageKey, id);
          setZones(saved.zones); setAllocations(validLocalAllocations(saved, inventory, id)); setTemporary(true);
          setSelected(previous => previous && previous !== 'unassigned' && !saved.zones.some(zone => zone.id === previous) ? 'unassigned' : previous);
        } else if (failures.length) {
          setError(failures.map(({ table, error }) => {
            const guidance = ['PGRST205', '42P01'].includes(error.code)
              ? 'The zone table is missing from this app’s connected database or its API schema cache.'
              : error.code === '42501' ? 'The database denied access to zone data.'
              : ['PGRST301', 'PGRST303'].includes(error.code) ? 'Your sign-in session could not be verified. Sign out and sign in again.'
              : 'The database request failed.';
            return `${guidance} ${table}${error.code ? ` [${error.code}]` : ''}: ${error.message}${error.hint ? ` Hint: ${error.hint}` : ''}`;
          }).join('\n\n'));
        } else {
          setZones(z.data as WarehouseZone[]); setAllocations(a.data as ZoneAllocation[]);
          setSelected(previous => previous && previous !== 'unassigned' && !z.data.some(zone => zone.id === previous) ? 'unassigned' : previous);
        }
      } catch (cause) {
        if (active) setError(`Unable to connect to warehouse data: ${cause instanceof Error ? cause.message : 'Check your connection and retry.'}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id, reload, inventory, storageKey]);

  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) setReload(n => n + 1); };
    const refreshOnFocus = () => setReload(n => n + 1);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [storageKey]);

  const selectedZone = zones.find(z => z.id === selected);
  const selectedName = selected === 'unassigned' ? 'Unassigned' : selectedZone?.name;
  const count = (product: string, zone: string) => zoneQuantity(allocations, inventory, id, product, zone);
  const summaries = (zone: string) => products.reduce((sum, p) => ({ units: sum.units + count(p.id, zone), products: sum.products + (count(p.id, zone) !== 0 ? 1 : 0) }), { units: 0, products: 0 });
  const rows = products.filter(p => count(p.id, selected) !== 0 && `${p.sku} ${p.name} ${p.category} ${p.supplier || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const nextName = () => { let n = 1; while (zones.some(z => z.name.toLowerCase() === `zone ${n}`)) n++; return `Zone ${n}`; };

  async function saveZone() {
    if (!editor || !canEdit || saving) return;
    setSaving(true); setFormError('');
    try {
      if (temporary) {
        const saved = readLocalLayout(localStorage, storageKey, id);
        const trimmed = name.trim();
        if (editor.mode !== 'delete') {
          if (!trimmed || trimmed.length > 60) throw new Error('Enter a zone name between 1 and 60 characters.');
          if (saved.zones.some(z => z.id !== editor.zone?.id && z.name.toLowerCase() === trimmed.toLowerCase())) throw new Error('A zone with this name already exists in this warehouse.');
        }
        if (editor.mode !== 'add' && !saved.zones.some(z => z.id === editor.zone?.id)) throw new Error('Zone no longer exists. Refresh the layout.');
        if (editor.mode === 'add') saved.zones.push({ id: crypto.randomUUID(), warehouseId: id, name: trimmed, sortOrder: Math.max(-1, ...saved.zones.map(z => z.sortOrder)) + 1 });
        else if (editor.mode === 'rename') saved.zones = saved.zones.map(z => z.id === editor.zone?.id ? { ...z, name: trimmed } : z);
        else { saved.zones = saved.zones.filter(z => z.id !== editor.zone?.id); saved.allocations = saved.allocations.filter(a => a.zoneId !== editor.zone?.id); }
        localStorage.setItem(storageKey, JSON.stringify(saved));
      } else {
        const { error } = await supabase.rpc('manage_warehouse_zone', { p_warehouse: id, p_zone: editor.zone?.id || null, p_action: editor.mode, p_name: name.trim() });
        if (error) throw error;
      }
      if (editor.mode === 'delete' && selected === editor.zone?.id) setSelected('unassigned');
      setEditor(null); setReload(n => n + 1); toast.success(editor.mode === 'delete' ? 'Zone deleted. Its stock is now Unassigned.' : 'Zone saved');
    } catch (e) { setFormError((e as Error).message || 'Unable to save zone.'); }
    finally { setSaving(false); }
  }

  const selectedSummary = summaries(selected);
  const unassignedSummary = summaries('unassigned');

  function floorplan(compact = false) {
    return <WarehouseFloorplan key={`${storageKey}:${compact}`} warehouseId={id} storageKey={storageKey} zones={zones}
      canEdit={canEdit && !compact} compact={compact} selected={selected} summary={summaries}
      onSelect={zoneId => { setSelected(zoneId); setSearch(''); }}
      onZoneAction={(mode, zone) => { setEditor({ mode, zone }); setName(zone?.name || nextName()); setFormError(''); }} />;
  }

  function unassignedCard() {
    return <button type="button" onClick={() => { setSelected('unassigned'); setSearch(''); }} aria-pressed={selected === 'unassigned'}
      className="flex w-full items-center gap-3 rounded-xl border bg-muted/30 p-4 text-left transition hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
      <Package className="size-5 shrink-0 text-muted-foreground" /><div><p className="text-sm font-semibold">Unassigned Stock</p><p className="mt-1 text-xs text-muted-foreground">{unassignedSummary.units.toLocaleString()} units · {unassignedSummary.products.toLocaleString()} products</p><p className="mt-1 text-xs text-muted-foreground">Stock not yet allocated to a zone.</p></div>
    </button>;
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-bold">{selectedName ? 'Zone Inventory' : 'Warehouse Layout'}</h2><Badge variant="outline" className="gap-1.5"><Grid2X2 className="size-3" />Not to Scale</Badge></div>
    {temporary && !error && <div role="status" className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs"><Info className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Temporary layout · Saved in this browser</p><p className="mt-1 text-muted-foreground">Zones and allocations are local to your account in this browser; they do not sync with Inventory Movement.</p><details className="mt-1 text-muted-foreground"><summary className="w-fit cursor-pointer">Storage details</summary><p className="mt-1">Clearing browser data removes this layout. If stock falls below temporary allocations, that product appears as Unassigned. Temporary data is not automatically imported when database storage becomes available.</p></details></div></div>}
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full space-y-2 sm:w-72"><Label htmlFor="layout-warehouse">Warehouse</Label><Select value={id} onValueChange={v => setWarehouseId(v || '')}><SelectTrigger id="layout-warehouse" className="w-full bg-card"><SelectValue placeholder="Select warehouse">{warehouse?.name}</SelectValue></SelectTrigger><SelectContent>{allowed.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
    </div>
    {!warehouse ? <div className="rounded-2xl border p-12 text-center text-muted-foreground">No warehouses are available for your account.</div> : loading ? <div role="status" className="flex justify-center gap-2 p-12 text-muted-foreground"><Loader2 className="size-5 animate-spin" />Loading warehouse layout...</div> : error ? <div role="alert" className="rounded-xl border p-6"><p>{error}</p><Button variant="outline" className="mt-3" onClick={() => setReload(n => n + 1)}>Retry</Button></div> : selectedName ? <div className="grid items-start gap-5 lg:grid-cols-4">
      <aside className="min-w-0 space-y-4">
        <Button variant="ghost" className="h-auto whitespace-normal px-0 text-left" onClick={() => { setSelected(''); setSearch(''); }}><ArrowLeft className="size-4 shrink-0" />Back to Warehouse Layout</Button>
        <section className="rounded-2xl border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground">{selectedZone ? 'Selected Zone' : 'Unallocated inventory'}</p><h3 className="mt-2 break-words text-xl font-bold">{selectedName}</h3><p className="mt-1 break-words text-sm text-muted-foreground">{warehouse.name}</p>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t pt-4"><div><dt className="text-xs text-muted-foreground">Total products</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{selectedSummary.products.toLocaleString()}</dd></div><div><dt className="text-xs text-muted-foreground">Total units</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{selectedSummary.units.toLocaleString()}</dd></div></dl>
        </section>
        {zones.length > 0 && <nav aria-label="Warehouse zones" className="rounded-2xl border bg-card p-4"><p className="mb-3 text-xs font-medium text-muted-foreground">Zone overview · Not to Scale</p>{floorplan(true)}</nav>}
        {unassignedCard()}
      </aside>
      <section className="min-w-0 overflow-hidden rounded-2xl border bg-card lg:col-span-3">
        <div className="space-y-4 border-b p-5"><div><h3 className="break-words text-lg font-bold">{selectedZone ? `Products Recorded in ${selectedZone.name}` : 'Unassigned Stock'}</h3><p className="mt-1 text-sm text-muted-foreground">{selectedZone ? 'View recorded inventory. Manage stock through inventory allocation or Inventory Movement.' : 'Stock that has not yet been allocated to a zone.'}</p></div><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search zone products" placeholder="Search SKU, item, category or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div></div>
        <Table><TableHeader className="bg-muted/40"><TableRow><TableHead>SKU</TableHead><TableHead>Item Name</TableHead><TableHead>Category</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">{selectedZone ? 'Stock Qty in Zone' : 'Unassigned Qty'}</TableHead></TableRow></TableHeader><TableBody>{rows.map(p => <TableRow key={p.id}><TableCell className="text-xs font-medium">{p.sku}</TableCell><TableCell className="font-medium">{p.name}</TableCell><TableCell>{p.category || '—'}</TableCell><TableCell>{p.supplier || '—'}</TableCell><TableCell className="text-right font-semibold tabular-nums">{count(p.id, selected).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table>
        {!rows.length && <div className="p-12 text-center"><Package className="mx-auto mb-3 size-8 text-muted-foreground/50" /><p className="font-medium">{search ? 'No matching products' : 'No stock recorded here yet'}</p><p className="mt-1 text-sm text-muted-foreground">{search ? 'Try another SKU or item name.' : 'Products appear here when stock is allocated to this location.'}</p></div>}
        <div className="border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground">{rows.length} products shown · Quantities are included in the existing warehouse total.</div>
      </section>
    </div> : <>
      <section aria-label="Warehouse Zone Layout" className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-gold/20 p-2.5"><WarehouseIcon className="size-5" /></div><div className="min-w-0"><h3 className="break-words font-semibold">{warehouse.name}</h3><p className="text-xs text-muted-foreground">Warehouse Zone Layout · {zones.length} zones</p></div></div>
        {floorplan()}
        <p className="mt-5 text-xs text-muted-foreground">Conceptual zones only. This layout does not represent the physical shape or scale of the warehouse.</p>
      </section>
      {unassignedCard()}
    </>}
    <Dialog open={!!editor} onOpenChange={open => { if (!open && !saving) setEditor(null); }}><DialogContent><DialogHeader><DialogTitle>{editor?.mode === 'delete' ? 'Delete zone?' : editor?.mode === 'rename' ? 'Rename zone' : 'Add zone'}</DialogTitle><DialogDescription>{editor?.mode === 'delete' ? `Stock recorded in ${editor.zone?.name} will become Unassigned. Warehouse totals stay the same.` : 'Create or rename a zone, then arrange it in Edit Layout.'}</DialogDescription></DialogHeader>
      {editor?.mode !== 'delete' && <div className="space-y-2"><Label htmlFor="zone-name">Zone name</Label><Input id="zone-name" autoFocus maxLength={60} value={name} onChange={e => setName(e.target.value)} /></div>}{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => setEditor(null)}>Cancel</Button><Button disabled={saving || (editor?.mode !== 'delete' && !name.trim())} variant={editor?.mode === 'delete' ? 'destructive' : 'default'} onClick={saveZone}>{saving ? 'Saving…' : editor?.mode === 'delete' ? 'Delete zone' : 'Save zone'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
