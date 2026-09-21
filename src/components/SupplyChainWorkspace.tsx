import { getSupplyChainViews, hasAdminRole } from '../lib/staffPermissions';
import { useStaffAccess } from '../hooks/useStaffAccess';
import { useEffect, useState } from 'react';
import { Users, Truck, Warehouse as WarehouseIcon, Search, Plus, Pencil, Trash2, MapPin, Phone, UserRound, CalendarDays, ArrowDownLeft, ArrowUpRight, CreditCard, RotateCcw, Eye, Package, Loader2, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db, collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from '../lib/supabaseAdapter';
import type { InventoryItem, Order, OrderItem, Product, Transfer, Warehouse } from '../types';
import type { InventoryMovementRecord } from '../lib/inventoryMovement';
import { dateValue, isOverdue, orderBalance, supportsAction, type ChainTransaction, type SupplyView } from '../lib/supplyChain';
import { SupplyChainTransactionDialog, chainMoney, Field } from './SupplyChainTransactionDialog';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

interface Entity { id: string; name: string; address?: string; contact?: string; phone?: string; terms?: string; active?: boolean; draft?: boolean; }
interface Props {
  sourceLoading: boolean;
  sourceError: boolean;
  onRetrySources: () => void;
  products: Product[];
  inventory: InventoryItem[];
  warehouses: Warehouse[];
  suppliers: { id: string; name: string }[];
  onRemoveWarehouse: (warehouse: Warehouse) => void;
  onRemoveSupplier: (name: string) => void;
  categoriesContent: React.ReactNode;
}
type SourceOrder = Order & { dueDate?: string; remainingBalance?: number };
const views = [{ id: 'customers' as const, name: 'Customers', icon: Users }, { id: 'suppliers' as const, name: 'Suppliers', icon: Truck }, { id: 'warehouses' as const, name: 'Warehouses', icon: WarehouseIcon }];
const filters = { customers: ['All', 'Order', 'Payment', 'Refund'], suppliers: ['All', 'Purchase', 'Bill Payment', 'Purchase Refund'], warehouses: ['All', 'Purchase', 'Transfer In', 'Transfer Out', 'Order', 'Purchase Refund', 'Order Refund'] };
const formatDate = (value?: string) => value && dateValue(value) ? new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function SupplyChainWorkspace({ sourceLoading, sourceError, onRetrySources, products, inventory, warehouses, suppliers, onRemoveWarehouse, onRemoveSupplier, categoriesContent }: Props) {
  const { profile } = useAuth();
  const { permissions, hasDelegation } = useStaffAccess();
  const canManage = profile?.role === 'admin';
  const allowedViews = views.filter(item => getSupplyChainViews(permissions.supplyChain).includes(item.id));
  const canViewValuation = hasAdminRole(profile);
  const [showCategories, setShowCategories] = useState(false);
  const [view, setView] = useState<SupplyView>(allowedViews[0]?.id || 'customers');
  const [entityId, setEntityId] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [selectedId, setSelectedId] = useState('');
  const [orders, setOrders] = useState<SourceOrder[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [reload, setReload] = useState(0);
  const [details, setDetails] = useState<ChainTransaction | null>(null);
  const [action, setAction] = useState<'payment' | 'refund' | null>(null);
  const [previews, setPreviews] = useState<ChainTransaction[]>([]);
  const [customerDrafts, setCustomerDrafts] = useState<Entity[]>([]);
  const [metadata, setMetadata] = useState<Record<string, Partial<Entity>>>({});
  const [hiddenCustomers, setHiddenCustomers] = useState<string[]>([]);
  const [editor, setEditor] = useState<Entity | null>(null);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    setLoaded({}); setErrors({});
    const watch = <T,>(table: string, update: (records: T[]) => void) => onSnapshot(collection(db, table), snap => {
      update(snap.docs.map(d => ({ id: d.id, ...d.data() } as T)));
      setLoaded(current => ({ ...current, [table]: true }));
      setErrors(current => ({ ...current, [table]: false }));
    }, () => { setErrors(current => ({ ...current, [table]: true })); setLoaded(current => ({ ...current, [table]: true })); });
    const stops = [watch('orders', setOrders), watch('order_items', setOrderItems), watch('inventory_movements', setMovements), watch('transfers', setTransfers)];
    return () => stops.forEach(stop => stop());
  }, [reload]);

  // Orders currently create a new clientId for each order. Group the directory by
  // normalized customer name until the app has a persistent customer directory.
  const customerKey = (name: string) => `customer:${name.trim().toLowerCase()}`;
  const customers = Array.from(new Map(orders.filter(o => o.clientName?.trim()).map(order => [customerKey(order.clientName), { id: customerKey(order.clientName), name: order.clientName, address: order.deliveryRegion }])).values());
  const baseEntities: Entity[] = view === 'customers' ? [...customers, ...customerDrafts].filter(c => !hiddenCustomers.includes(c.id)) : view === 'suppliers' ? suppliers : warehouses.map(w => ({ ...w, address: w.location }));
  const entities = baseEntities.map(entity => ({ ...entity, ...metadata[`${view}:${entity.id}`] })).sort((a, b) => a.name.localeCompare(b.name));
  const visibleEntities = entities.filter(entity => `${entity.name} ${entity.address || ''} ${entity.contact || ''}`.toLowerCase().includes(directorySearch.toLowerCase()));
  const current = entities.find(entity => entity.id === entityId) ?? visibleEntities[0];
  const warehouse = view === 'warehouses';
  const customer = view === 'customers';
  const singular = warehouse ? 'warehouse' : customer ? 'customer' : 'supplier';
  const title = views.find(item => item.id === view)!.name;
  const requiredTables = customer ? ['orders', 'order_items'] : warehouse ? ['orders', 'order_items', 'inventory_movements', 'transfers'] : ['inventory_movements'];
  const loading = sourceLoading || requiredTables.some(table => !loaded[table]);
  const loadError = sourceError || requiredTables.some(table => errors[table]);

  const orderRows: ChainTransaction[] = orders.map(order => ({
    id: order.id, entityId: customerKey(order.clientName || ''), type: 'Order', date: dateValue(order.createdAt), reference: order.orderNumber,
    amount: Number(order.totalAmount), remaining: orderBalance(order), dueDate: dateValue(order.dueDate), status: order.status,
    items: orderItems.filter(item => item.orderId === order.id).map(item => ({ ...item, unitPrice: Number(item.unitPrice), quantity: Number(item.quantity) })),
    direction: order.status === 'cancelled' ? undefined : 'out',
  }));
  const purchaseRows: ChainTransaction[] = movements.filter(m => m.type === 'external').map(movement => ({
    id: movement.id, entityId: movement.supplierId || '', type: 'Purchase', date: dateValue(movement.createdAt), reference: movement.invoiceNumber || movement.movementNumber,
    amount: movement.totalValue == null ? null : Number(movement.totalValue), remaining: null, status: movement.status,
    items: movement.items.map((line, i) => ({ ...line, id: `${movement.id}:${i}`, warehouseId: movement.destinationWarehouseId, unitPrice: Number(line.unitCost) })), direction: 'in',
    notes: `Receipt ${movement.movementNumber}. Supplier payment status is not recorded in inventory receipts.`,
  }));
  const warehouseRows: ChainTransaction[] = current && warehouse ? [
    ...transfers.filter(t => t.sourceWarehouseId === current.id || t.destinationWarehouseId === current.id).map(t => {
      const incoming = t.destinationWarehouseId === current.id;
      const product = products.find(p => p.id === t.productId);
      const moved = incoming ? t.status === 'received' : ['in_transit', 'received'].includes(t.status);
      return {
        id: `transfer:${t.id}`, entityId: current.id, type: incoming ? 'Transfer In' : 'Transfer Out',
        date: dateValue((incoming ? t.receivedAt : t.dispatchedAt) || t.createdAt), reference: t.id,
        amount: null, remaining: null, status: t.status,
        direction: moved ? incoming ? 'in' as const : 'out' as const : undefined,
        items: [{ id: t.id, productId: t.productId, name: product?.name || 'Product unavailable', sku: product?.sku || '', quantity: t.quantity, unitPrice: null, warehouseId: current.id }],
        notes: `${warehouses.find(w => w.id === t.sourceWarehouseId)?.name || 'Source warehouse'} → ${warehouses.find(w => w.id === t.destinationWarehouseId)?.name || 'Destination warehouse'}. ${moved ? 'Stock movement recorded.' : t.status === 'cancelled' ? 'Cancelled transfer; no net stock movement.' : 'Stock has not arrived at or left this warehouse yet.'} Historical item valuation was not recorded.`,
      };
    }),
    ...movements.filter(m => m.sourceWarehouseId === current.id || m.destinationWarehouseId === current.id).map(m => {
      const incoming = m.destinationWarehouseId === current.id;
      return { id: m.id, entityId: current.id, type: m.type === 'external' ? 'Purchase' : incoming ? 'Transfer In' : 'Transfer Out', date: dateValue(m.createdAt), reference: m.movementNumber,
        amount: m.totalValue == null ? null : Number(m.totalValue), remaining: null, status: m.status, direction: incoming ? 'in' as const : 'out' as const,
        items: m.items.map((line, i) => ({ ...line, id: `${m.id}:${i}`, unitPrice: Number(line.unitCost), warehouseId: current.id })),
        notes: `${m.sourceWarehouseName || m.supplierName || 'Supplier'} → ${m.destinationWarehouseName}${m.notes ? ` · ${m.notes}` : ''}` };
    }),
    ...orderRows.filter(row => row.status !== 'cancelled' && row.items.some(item => item.warehouseId === current.id)).map(row => {
      const items = row.items.filter(item => item.warehouseId === current.id);
      return { ...row, entityId: current.id, items, amount: items.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0) };
    }),
    ...previews.filter(row => row.direction && row.items.some(item => item.warehouseId === current.id)).map(row => ({ ...row, type: row.type === 'Refund' ? 'Order Refund' : row.type, entityId: current.id })),
  ] : [];
  const rows = (warehouse ? warehouseRows : [...(customer ? orderRows : purchaseRows), ...previews].filter(row => row.entityId === current?.id)).sort((a, b) => b.date.localeCompare(a.date));
  const filteredRows = rows.filter(row => (typeFilter === 'All' || row.type === typeFilter) && `${row.type} ${row.reference} ${row.status}`.toLowerCase().includes(search.toLowerCase()));
  const selected = filteredRows.find(row => row.id === selectedId);
  const committedRows = rows.filter(row => !row.draft && ['Order', 'Purchase'].includes(row.type));
  const unknownBalance = committedRows.some(row => row.remaining === null);
  const balance = committedRows.reduce((sum, row) => sum + (row.remaining ?? 0), 0);
  const overdueCount = committedRows.filter(row => isOverdue(row)).length;
  const stock = inventory.filter(item => item.warehouseId === current?.id);
  const missingCosts = stock.some(item => products.find(p => p.id === item.productId)?.costPrice == null && item.quantity !== 0);
  const valuation = stock.reduce((sum, item) => sum + item.quantity * Number(products.find(p => p.id === item.productId)?.costPrice ?? 0), 0);
  const previewPending = previews.some(row => row.parentId === selected?.id);
  const canAct = (kind: 'payment' | 'refund') => canManage && !loading && !loadError && !warehouse && !previewPending && supportsAction(selected, kind);

  function switchView(next: SupplyView) {
    setView(next); setEntityId(''); setDirectorySearch(''); setSearch(''); setTypeFilter('All'); setSelectedId(''); setAction(null);
  }

  async function saveEntity() {
    if (!editor || saving) return;
    if (!customer && (sourceLoading || sourceError)) { setEditError("Wait for the directory and inventory records to load before saving."); return; }
    const name = editor.name.trim();
    if (!name) { setEditError('Enter a name.'); return; }
    if (entities.some(e => e.id !== editor.id && e.name.trim().toLowerCase() === name.toLowerCase())) { setEditError(`A ${singular} with that name already exists.`); return; }
    setSaving(true); setEditError('');
    try {
      let id = editor.id;
      if (customer) {
        if (!id) { id = `draft:${crypto.randomUUID()}`; setCustomerDrafts(items => [...items, { ...editor, id, name, draft: true }]); }
      } else if (warehouse) {
        const payload = { name, location: editor.address?.trim() || 'Warehouse Facility', active: editor.active !== false };
        if (id) await updateDoc(doc(db, 'warehouses', id), payload);
        else {
          const saved = await addDoc(collection(db, 'warehouses'), payload); id = saved.id;
          for (const product of products) await addDoc(collection(db, 'inventory'), { productId: product.id, warehouseId: id, quantity: 0, lastUpdated: serverTimestamp() });
        }
      } else {
        if (id) {
          const original = suppliers.find(supplier => supplier.id === id);
          await updateDoc(doc(db, 'suppliers', id), { name, updatedAt: serverTimestamp() });
          if (original && original.name !== name) for (const product of products.filter(p => p.supplier === original.name)) await updateDoc(doc(db, 'products', product.id), { supplier: name, updatedAt: serverTimestamp() });
        } else id = (await addDoc(collection(db, 'suppliers'), { name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })).id;
      }
      // The existing schema has no directory contact/payment-term columns.
      // Keep these explicitly labeled fields in this module's preview state only.
      setMetadata(items => ({ ...items, [`${view}:${id}`]: { ...(customer ? { name, address: editor.address, draft: true } : !warehouse ? { address: editor.address } : {}), contact: editor.contact, phone: editor.phone, terms: editor.terms } }));
      setEntityId(id); setEditor(null);
      toast.success(customer ? 'Customer preview updated' : `${warehouse ? 'Warehouse' : 'Supplier'} saved; contact details kept in this preview`);
    } catch { setEditError(`Could not finish saving this ${singular}. Check the current record before retrying.`); }
    finally { setSaving(false); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Partners & inventory</p><h1 className="text-2xl font-bold tracking-tight">Supply Chain</h1><p className="mt-1 text-sm text-muted-foreground">Your customers, suppliers, warehouses, and categories. Connected in one place.</p></div></div>
    <div className="flex flex-wrap gap-1 rounded-2xl border bg-muted/40 p-1.5" role="group" aria-label="Supply Chain views">{allowedViews.map(({ id, name, icon: Icon }) => <button key={id} type="button" aria-pressed={!showCategories && view === id} onClick={() => { setShowCategories(false); switchView(id); }} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${!showCategories && view === id ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}><Icon className="size-4" />{name}</button>)}{canManage && <button type="button" aria-pressed={showCategories} onClick={() => setShowCategories(true)} className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${showCategories ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}><Package className="size-4" />Categories</button>}</div>
    {showCategories ? categoriesContent : <><div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="space-y-3 border-b p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">{title} <span className="ml-1 text-xs font-normal text-muted-foreground">{entities.length}</span></h2>{canManage && <Button size="sm" onClick={() => { setEditError(''); setEditor({ id: '', name: '', active: true }); }}><Plus className="size-4" />Add</Button>}</div><SearchBox value={directorySearch} onChange={setDirectorySearch} placeholder={`Search ${title.toLowerCase()}…`} /></div>
        <div className="max-h-64 overflow-y-auto p-2 xl:max-h-[640px]">{visibleEntities.map(entity => <button key={entity.id} type="button" onClick={() => { setEntityId(entity.id); setSelectedId(''); setSearch(''); }} aria-pressed={current?.id === entity.id} className={`mb-1 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${current?.id === entity.id ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{entity.name}</span><span className="block truncate text-xs text-muted-foreground">{entity.draft ? 'Preview customer' : warehouse ? [entity.address, entity.active === false ? 'Inactive' : 'Active warehouse'].filter(Boolean).join(' / ') : entity.address || (customer ? 'From order records' : 'Supplier account')}</span></span></button>)}{!visibleEntities.length && <div className="p-6 text-center text-sm text-muted-foreground">{loading ? 'Loading records…' : directorySearch ? 'No matching records.' : `No ${title.toLowerCase()} yet.`}</div>}</div>
        {customer && <p className="border-t px-4 py-3 text-xs text-muted-foreground">Customers are grouped by name from existing orders. New profiles are previews.</p>}
      </aside>
      <div className="min-w-0 space-y-5">
        {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><span><AlertCircle className="mr-2 inline size-4" />Some records could not load. Totals and actions are unavailable.</span><Button variant="outline" size="sm" onClick={() => { setReload(n => n + 1); onRetrySources(); }}>Retry</Button></div>}
        {current ? <>
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 p-5"><div><div className="mb-2 flex items-center gap-2"><Badge variant="secondary">{warehouse ? 'Warehouse' : customer ? 'Customer account' : 'Supplier account'}</Badge>{warehouse && <Badge variant={current.active === false ? 'outline' : 'secondary'}>{current.active === false ? 'Inactive' : 'Active'}</Badge>}{current.draft && <Badge variant="outline">Preview</Badge>}</div><h2 className="text-xl font-bold">{current.name}</h2></div>{canManage && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setEditError(''); setEditor({ ...current }); }}><Pencil className="size-3.5" />Edit</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(true)}><Trash2 className="size-3.5" />Remove</Button></div>}</div>
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2"><InfoField icon={MapPin} label={warehouse ? "Location" : "Address"} value={current.address} /><InfoField icon={UserRound} label="Contact person" value={current.contact} /><InfoField icon={Phone} label="Contact number" value={current.phone} /><InfoField icon={CalendarDays} label={warehouse ? 'Status' : 'Payment terms'} value={warehouse ? current.active === false ? 'Inactive' : 'Active' : current.terms} /></div>
            {metadata[`${view}:${current.id}`] && <p className="px-5 pb-4 text-xs text-amber-700 dark:text-amber-300">Contact details and payment terms are session previews.</p>}
            {(!warehouse || canViewValuation) && <div className="flex flex-wrap items-center justify-between gap-4 border-t bg-muted/30 px-5 py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{warehouse ? 'Total Inventory Valuation' : 'Total Open Balance'}</p><p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{loading ? 'Loading…' : loadError ? 'Unavailable' : warehouse ? chainMoney(missingCosts ? null : valuation) : chainMoney(unknownBalance ? null : balance)}</p><p className="mt-1 text-xs text-muted-foreground">{warehouse ? missingCosts ? 'Some inventory items are missing cost prices.' : 'At product cost · Visible to administrators' : unknownBalance ? `Exact ${customer ? 'receivables' : 'payables'} are not available in the source records.` : customer ? 'Outstanding customer receivables' : 'Outstanding supplier payables'}</p></div>{overdueCount > 0 && <Badge variant="destructive">{overdueCount} overdue {overdueCount === 1 ? 'order' : 'orders'}</Badge>}{warehouse && <div className="text-right"><p className="text-xl font-semibold">{stock.reduce((sum, item) => sum + item.quantity, 0).toLocaleString()}</p><p className="text-xs text-muted-foreground">units on hand</p></div>}</div>}
          </section>
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><h2 className="font-semibold">{warehouse ? 'Inventory Movement History' : 'Transaction History'}</h2><p className="mt-1 text-xs text-muted-foreground">{warehouse ? 'Track what comes in and what goes out.' : `Select ${customer ? 'an order' : 'a purchase'} to preview a payment or refund.`} Double-click a row to view details.</p></div>{canManage && !warehouse && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!canAct('refund')} onClick={() => setAction('refund')}><RotateCcw className="size-3.5" />Refund</Button><Button size="sm" disabled={!canAct('payment')} onClick={() => setAction('payment')}><CreditCard className="size-3.5" />Payment</Button></div>}</div>
            <div className="flex flex-wrap gap-3 p-4"><div className="min-w-48 flex-1"><SearchBox value={search} onChange={value => { setSearch(value); setSelectedId(''); }} placeholder="Search by reference or transaction…" /></div><select aria-label="Transaction type" className="h-10 rounded-lg border bg-background px-3 text-sm" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setSelectedId(''); }}>{filters[view].map(type => <option key={type} value={type}>{type === 'All' ? 'All transaction types' : type}</option>)}</select></div>
            {selected && <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs"><span className="font-medium">Selected: {selected.reference}{previewPending && ' · Preview already added'}</span><Button variant="ghost" size="sm" onClick={() => setSelectedId('')} className="h-7"><X className="size-3" />Clear</Button></div>}
            <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-muted/40"><TableHead>{warehouse ? 'Entry Type' : 'Type'}</TableHead><TableHead>Date</TableHead><TableHead>{warehouse ? 'Reference / Action #' : customer ? 'Order #' : 'Purchase #'}</TableHead><TableHead className="text-right">{warehouse ? 'Amount / Value' : 'Amount'}</TableHead>{warehouse ? <TableHead>Status</TableHead> : <><TableHead className="text-right">Remaining Balance</TableHead><TableHead>Due Date</TableHead></>}<TableHead><span className="sr-only">Details</span></TableHead></TableRow></TableHeader><TableBody>
              {!loading && filteredRows.map(row => <TableRow key={row.id} tabIndex={0} aria-selected={selectedId === row.id} onClick={() => setSelectedId(row.id)} onDoubleClick={() => setDetails(row)} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter') { event.preventDefault(); setDetails(row); } if (event.key === ' ') { event.preventDefault(); setSelectedId(row.id); } }} className={`cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selectedId === row.id ? 'bg-primary/10 hover:bg-primary/15' : ''} ${isOverdue(row) ? 'bg-red-500/5' : ''}`}><TableCell><div className="flex items-center gap-2 whitespace-nowrap">{row.direction === 'in' ? <ArrowDownLeft className="size-4 text-emerald-600" /> : row.direction === 'out' ? <ArrowUpRight className="size-4 text-orange-600" /> : <CreditCard className="size-4 text-muted-foreground" />}<span className="text-sm font-medium">{row.type}</span>{row.draft && <Badge variant="outline">Preview</Badge>}</div></TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(row.date)}</TableCell><TableCell className="font-mono text-xs">{row.reference}</TableCell><TableCell className="text-right tabular-nums">{chainMoney(row.amount)}</TableCell>{warehouse ? <TableCell><Badge variant="secondary" className="capitalize">{row.status.replaceAll('_', ' ')}</Badge></TableCell> : <><TableCell className={`text-right font-medium tabular-nums ${isOverdue(row) ? 'text-red-600' : ''}`}>{chainMoney(row.remaining)}</TableCell><TableCell className="whitespace-nowrap text-xs">{formatDate(row.dueDate)}{isOverdue(row) && <span className="mt-1 block font-semibold text-red-600">Overdue</span>}</TableCell></>}<TableCell><Button variant="ghost" size="icon" aria-label={`View ${row.reference}`} onClick={event => { event.stopPropagation(); setDetails(row); }}><Eye className="size-4" /></Button></TableCell></TableRow>)}
              {(loading || !filteredRows.length) && <TableRow><TableCell colSpan={warehouse ? 6 : 7} className="h-56 text-center"><div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-muted-foreground">{loading ? <Loader2 className="size-7 animate-spin" /> : <Package className="size-8 opacity-40" />}<p className="font-medium text-foreground">{loading ? 'Loading history…' : loadError ? 'History unavailable' : search || typeFilter !== 'All' ? 'No matching transactions' : 'No transactions yet'}</p><p className="text-xs">{loading ? 'Getting your latest records.' : search || typeFilter !== 'All' ? 'Try another search or transaction type.' : `Activity for ${current.name} will appear here.`}</p>{(search || typeFilter !== 'All') && <Button size="sm" variant="outline" onClick={() => { setSearch(''); setTypeFilter('All'); }}>Reset filters</Button>}</div></TableCell></TableRow>}
            </TableBody></Table></div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground"><span>{filteredRows.length} {filteredRows.length === 1 ? 'entry' : 'entries'}{warehouse && ' · ↑ Outgoing  ↓ Incoming'}</span>{previews.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setPreviews([]); setSelectedId(''); }}>Clear transaction previews</Button>}</div>
          </section>
          <p className="text-xs leading-relaxed text-muted-foreground">{warehouse ? 'History uses inventory receipts, transfers, and orders with a recorded warehouse. Financial previews do not change stock.' : 'Payments and refunds are interactive previews. Due dates appear only when recorded; delivery deadlines are not treated as payment due dates.'}</p>
        </> : <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center"><Users className="mb-3 size-9 text-muted-foreground/40" /><h2 className="font-semibold">{loading ? 'Loading directory…' : `Select a ${singular}`}</h2><p className="mt-2 text-sm text-muted-foreground">Choose a record on the left, or add one to get started.</p></div>}
      </div>
    </div>

    {action && selected && canAct(action) && <SupplyChainTransactionDialog key={`${selected.id}:${action}`} view={view} action={action} transaction={selected} products={products} warehouses={warehouses} inventory={inventory} onClose={() => setAction(null)} onPreview={entry => { setPreviews(rows => [...rows, entry]); setAction(null); setSelectedId(entry.id); setTypeFilter('All'); setSearch(''); toast.success('Preview added. No financial or inventory changes posted.'); }} />}

    <Dialog open={!!details} onOpenChange={open => { if (!open) setDetails(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{details?.type} details</DialogTitle><DialogDescription>{details?.reference} · {formatDate(details?.date)}</DialogDescription></DialogHeader>{details && <><div className="flex flex-wrap justify-between gap-3 rounded-xl bg-muted/40 p-4"><div><p className="text-xs text-muted-foreground">Amount / value</p><p className="text-2xl font-bold">{chainMoney(details.amount)}</p></div><Badge variant="secondary" className="h-fit capitalize">{details.status.replaceAll('_', ' ')}</Badge></div>{details.direction && <div className={`rounded-lg p-3 text-sm ${details.direction === 'in' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-orange-500/10 text-orange-700 dark:text-orange-300'}`}>{details.draft ? 'Preview: inventory would ' : 'Inventory direction: '}{details.direction === 'in' ? 'increase — items received' : 'decrease — items issued'}</div>}{details.notes && <p className="text-sm text-muted-foreground">{details.notes}</p>}<Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Unit value</TableHead></TableRow></TableHeader><TableBody>{details.items.map(item => <TableRow key={item.id}><TableCell><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.sku}{item.warehouseId && ` · ${warehouses.find(w => w.id === item.warehouseId)?.name || 'Warehouse'}`}</p></TableCell><TableCell className="text-right">{item.quantity}</TableCell><TableCell className="text-right">{chainMoney(item.unitPrice)}</TableCell></TableRow>)}{!details.items.length && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No physical items recorded.</TableCell></TableRow>}</TableBody></Table>{details.draft && <p className="text-xs text-amber-700 dark:text-amber-300">Session preview only. No financial or inventory changes posted.</p>}<Button variant="outline" onClick={() => setDetails(null)}>Close</Button></>}</DialogContent></Dialog>

    <Dialog open={!!editor} onOpenChange={open => { if (!open && !saving) setEditor(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{editor?.id ? 'Edit' : 'Add'} {singular}</DialogTitle><DialogDescription>{customer ? 'Customer profiles are session previews until a customer directory is connected.' : `The ${warehouse ? 'name, location, and status' : 'name'} will be saved. Contact details${!warehouse ? ', address, and payment terms' : ''} are session previews.`}</DialogDescription></DialogHeader>{editor && <form onSubmit={event => { event.preventDefault(); void saveEntity(); }} className="space-y-4"><Field label="Name" id="chain-entity-name"><Input id="chain-entity-name" required value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} /></Field><Field label={warehouse ? "Location" : "Address"} id="chain-entity-address"><Input id="chain-entity-address" value={editor.address || ''} onChange={e => setEditor({ ...editor, address: e.target.value })} placeholder={warehouse ? "e.g. Hub 1" : "Street, city, province"} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Contact person" id="chain-entity-contact"><Input id="chain-entity-contact" value={editor.contact || ''} onChange={e => setEditor({ ...editor, contact: e.target.value })} /></Field><Field label="Contact number" id="chain-entity-phone"><Input id="chain-entity-phone" type="tel" value={editor.phone || ''} onChange={e => setEditor({ ...editor, phone: e.target.value })} /></Field></div>{warehouse ? <Field label="Status" id="chain-entity-status"><select id="chain-entity-status" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={editor.active === false ? 'inactive' : 'active'} onChange={e => setEditor({ ...editor, active: e.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field> : <Field label="Payment terms" id="chain-entity-terms"><Input id="chain-entity-terms" value={editor.terms || ''} onChange={e => setEditor({ ...editor, terms: e.target.value })} placeholder="e.g. Cash on delivery, Net 30" /></Field>}{editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}<div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={saving} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={saving || !editor.name.trim()}>{saving ? 'Saving…' : customer ? 'Save preview' : 'Save changes'}</Button></div></form>}</DialogContent></Dialog>

    <Dialog open={removing} onOpenChange={setRemoving}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Remove {current?.name}?</DialogTitle><DialogDescription>{customer ? 'This hides the customer from this session preview. Existing orders and balances are preserved.' : warehouse ? 'The existing warehouse removal flow will show the stock impact before deletion.' : 'The existing supplier removal flow will show which product assignments are affected.'}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRemoving(false)}>Cancel</Button><Button variant="destructive" onClick={() => { if (!current) return; if (customer) { setHiddenCustomers(ids => [...ids, current.id]); setEntityId(''); } else if (warehouse) { const record = warehouses.find(w => w.id === current.id); if (record) onRemoveWarehouse(record); } else onRemoveSupplier(current.name); setRemoving(false); }}>{customer ? 'Remove from preview' : 'Continue'}</Button></div></DialogContent></Dialog>
  </>}
  </div>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={placeholder} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="h-10 pl-9" /></div>;
}

function InfoField({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value?: string }) {
  return <div className="flex items-start gap-2.5"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-sm font-medium">{value || 'Not provided'}</p></div></div>;
}
