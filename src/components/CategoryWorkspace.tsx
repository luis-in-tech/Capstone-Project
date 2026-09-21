import { hasAdminRole } from '../lib/staffPermissions';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Archive, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { db, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from '../lib/supabaseAdapter';
import { useAuth } from '../hooks/useAuth';
import type { Product, InventoryItem, Warehouse } from '../types';
import { toast } from 'sonner';

interface Category { id: string; name: string; code?: string; description?: string; active?: boolean; }
interface Props { products: Product[]; inventory: InventoryItem[]; warehouses: Warehouse[]; suppliers: { id: string; name: string }[]; loading: boolean; error: boolean; onRetry: () => void; }
const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);

export function CategoryWorkspace({ products, inventory, warehouses, suppliers, loading, error, onRetry }: Props) {
  const { profile } = useAuth();
  const [records, setRecords] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selectedName, setSelectedName] = useState('');
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [section, setSection] = useState<'products' | 'warehouses' | 'suppliers'>('products');
  const [editor, setEditor] = useState<Category | null>(null);
  const [originalName, setOriginalName] = useState('');
  const [removing, setRemoving] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    setLoaded(false); setLoadError(false);
    return onSnapshot(collection(db, 'productCategories'), snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Category)));
      setLoaded(true); setLoadError(false);
    }, () => { setLoaded(true); setLoadError(true); });
  }, [reload]);

  // Include older product assignments that have no category record yet.
  const categories = [...records];
  for (const product of products) {
    const name = product.category || 'Uncategorized';
    if (!categories.some(category => category.name === name)) categories.push({ id: '', name, active: true });
  }
  categories.sort((a, b) => a.name.localeCompare(b.name));
  const current = categories.find(category => category.name === selectedName) || categories[0];
  const unavailable = loading || !loaded || error || loadError;
  const categoryProducts = products.filter(product => (product.category || 'Uncategorized') === current?.name);
  const productIds = new Set(categoryProducts.map(product => product.id));
  const stock = inventory.filter(item => productIds.has(item.productId));
  const stockByProduct = new Map<string, number>();
  for (const item of stock) stockByProduct.set(item.productId, (stockByProduct.get(item.productId) || 0) + item.quantity);
  const units = (product: Product) => stockByProduct.get(product.id) || 0;
  const low = (product: Product) => units(product) <= (product.minStockLevel || 0);
  const missingCosts = categoryProducts.some(product => units(product) !== 0 && product.costPrice == null);
  const valuation = categoryProducts.reduce((sum, product) => sum + units(product) * (product.costPrice ?? 0), 0);
  const supplierName = (product: Product) => suppliers.find(supplier => supplier.id === product.supplierId)?.name || product.supplier || 'N/A';
  const supplierNames = [...new Set(categoryProducts.map(supplierName))].filter(name => name !== 'N/A' && name.trim()).sort();
  const filteredProducts = categoryProducts.filter(product =>
    [product.sku, product.name].some(value => value.toLowerCase().includes(productSearch.toLowerCase())));

  const startEdit = (category?: Category) => {
    setOriginalName(category?.name || ''); setActionError('');
    setEditor(category ? { ...category } : { id: '', name: '', code: '', description: '', active: true });
  };
  const persist = async (category: Category) => {
    const data = { name: category.name.trim(), code: category.code?.trim().toUpperCase() || '', description: category.description?.trim() || '', active: category.active !== false, updatedAt: serverTimestamp() };
    if (category.id) await updateDoc(doc(db, 'productCategories', category.id), data);
    else await addDoc(collection(db, 'productCategories'), { ...data, createdAt: serverTimestamp() });
    setReload(value => value + 1);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || busy || unavailable) return;
    const name = editor.name.trim(), code = editor.code?.trim().toUpperCase();
    if (!name || !code) { setActionError('Category name and code are required.'); return; }
    if (categories.some(category => category.name !== originalName && (category.name.toLowerCase() === name.toLowerCase() || (category.code && category.code.toUpperCase() === code)))) {
      setActionError('A category with that name or code already exists.'); return;
    }
    setBusy(true); setActionError('');
    try {
      // Materialize legacy categories first so database rename protection can update assignments atomically.
      let id = editor.id;
      if (!id && originalName && name !== originalName) {
        const created = await addDoc(collection(db, 'productCategories'), { name: originalName, createdAt: serverTimestamp() });
        id = created.id;
      }
      await persist({ ...editor, id, name, code });
      setSelectedName(name); setEditor(null); toast.success('Category saved');
    } catch (err) { setActionError(err instanceof Error ? err.message : (err as { message?: string })?.message || 'Could not save category.'); }
    finally { setBusy(false); }
  };
  const archive = async () => {
    if (!current || unavailable || busy) return;
    setBusy(true);
    try { await persist({ ...current, active: current.active === false }); toast.success(current.active === false ? 'Category activated' : 'Category archived'); }
    catch { toast.error('Could not change category status.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing || unavailable || busy) return;
    if (products.some(product => (product.category || 'Uncategorized') === removing.name)) { setActionError('Reassign all products before deleting this category.'); return; }
    setBusy(true); setActionError('');
    try {
      await deleteDoc(doc(db, 'productCategories', removing.id));
      setRemoving(null); setSelectedName(''); setReload(value => value + 1); toast.success('Category deleted');
    } catch (err) { setActionError((err as { message?: string })?.message || 'Could not delete category.'); }
    finally { setBusy(false); }
  };

  return <div className="space-y-4">
    {(error || loadError) && <div role="alert" className="flex items-center justify-between rounded-xl border border-destructive/30 p-4 text-sm"><span>Category records could not load. Totals and actions are unavailable.</span><Button variant="outline" onClick={() => { setReload(value => value + 1); onRetry(); }}>Retry</Button></div>}
    <div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border bg-card shadow-sm">
        <div className="space-y-3 border-b p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Categories</h2><Button size="sm" disabled={unavailable || busy} onClick={() => startEdit()}><Plus className="size-4" />Add Category</Button></div><Input aria-label="Search categories by name or code" placeholder="Search name or code…" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <div className="max-h-[640px] overflow-y-auto p-2">
          {categories.filter(category => [category.name, category.code || ''].some(value => value.toLowerCase().includes(search.toLowerCase()))).map(category => <button type="button" key={category.id || category.name} aria-pressed={current?.name === category.name} onClick={() => { setSelectedName(category.name); setProductSearch(''); setSection('products'); }} className={`mb-1 w-full rounded-xl border p-3 text-left ${current?.name === category.name ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}><span className="block font-semibold">{category.name}</span><span className="block text-xs text-muted-foreground">{category.code || 'No code'} · {category.active === false ? 'Inactive' : 'Active'} · {products.filter(product => (product.category || 'Uncategorized') === category.name).length} products</span></button>)}
          {!categories.some(category => [category.name, category.code || ''].some(value => value.toLowerCase().includes(search.toLowerCase()))) && <p className="p-6 text-center text-sm text-muted-foreground">{loading || !loaded ? 'Loading categories…' : 'No categories found.'}</p>}
        </div>
      </aside>
      {current ? <div className="min-w-0 space-y-5">
        <section className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><Badge variant="secondary">{current.active === false ? 'Inactive' : 'Active'}</Badge><h2 className="mt-2 text-xl font-bold">{current.name}</h2><p className="text-sm text-muted-foreground">{current.code || 'No category code'}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={unavailable || busy} onClick={() => startEdit(current)}><Pencil className="size-4" />Edit</Button><Button size="sm" variant="outline" disabled={unavailable || busy} onClick={archive}><Archive className="size-4" />{current.active === false ? 'Activate' : 'Archive'}</Button><Button size="sm" variant="ghost" disabled={unavailable || busy || !current.id} onClick={() => { setRemoving(current); setActionError(''); }}><Trash2 className="size-4" />Delete</Button></div></div><p className="mt-4 text-sm text-muted-foreground">{current.description || 'No description provided.'}</p></section>
        <div className={`grid gap-3 sm:grid-cols-2 ${hasAdminRole(profile) ? '2xl:grid-cols-4' : '2xl:grid-cols-3'}`}>
          <Summary label="Products" value={unavailable ? '—' : categoryProducts.length.toLocaleString()} />
          <Summary label="Units in stock" value={unavailable ? '—' : stock.reduce((sum, item) => sum + item.quantity, 0).toLocaleString()} />
          <Summary label="Low-stock products" value={unavailable ? '—' : categoryProducts.filter(low).length.toLocaleString()} note="At or below minimum stock, including out of stock" />
          {hasAdminRole(profile) && <Summary label="Inventory valuation" value={unavailable || missingCosts ? 'Unavailable' : money(valuation)} note={missingCosts ? 'Some products are missing cost prices' : 'At product cost · Admin only'} />}
        </div>
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex gap-2 border-b p-3" role="group" aria-label="Category details">{(['products', 'warehouses', 'suppliers'] as const).map(tab => <Button key={tab} variant={section === tab ? 'default' : 'ghost'} aria-pressed={section === tab} onClick={() => setSection(tab)} className="capitalize">{tab}</Button>)}</div>
          {unavailable ? <p className="p-6 text-sm text-muted-foreground">{error || loadError ? 'Records unavailable.' : 'Loading records…'}</p> : section === 'products' ? <>
            <div className="flex flex-wrap gap-3 p-4"><Input className="min-w-48 flex-1" aria-label="Search category products" placeholder="Search SKU, product, or supplier…" value={productSearch} onChange={event => setProductSearch(event.target.value)} /><Link className="inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted" to={`/inventory?category=${encodeURIComponent(current.name)}`}>View in Inventory</Link></div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product Name</TableHead><TableHead className="text-right">Total Stock</TableHead></TableRow></TableHeader><TableBody>{filteredProducts.map(product => <TableRow key={product.id}><TableCell className="font-mono text-xs">{product.sku}</TableCell><TableCell><Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/inventory?product=${encodeURIComponent(product.id)}`}>{product.name}</Link></TableCell><TableCell className="text-right">{units(product).toLocaleString()}</TableCell></TableRow>)}{!filteredProducts.length && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No products found.</TableCell></TableRow>}</TableBody></Table></div>
          </> : section === 'warehouses' ? <Table><TableHeader><TableRow><TableHead>Warehouse</TableHead><TableHead className="text-right">Units in stock</TableHead></TableRow></TableHeader><TableBody>{[...new Set([...warehouses.map(warehouse => warehouse.id), ...stock.map(item => item.warehouseId)])].map(id => <TableRow key={id}><TableCell>{warehouses.find(warehouse => warehouse.id === id)?.name || 'Unknown warehouse'}</TableCell><TableCell className="text-right">{stock.filter(item => item.warehouseId === id).reduce((sum, item) => sum + item.quantity, 0).toLocaleString()}</TableCell></TableRow>)}{!warehouses.length && !stock.length && <TableRow><TableCell colSpan={2} className="py-8 text-center">No warehouse records.</TableCell></TableRow>}</TableBody></Table> : <Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className="text-right">Products in category</TableHead></TableRow></TableHeader><TableBody>{supplierNames.map(name => <TableRow key={name}><TableCell>{name}</TableCell><TableCell className="text-right">{categoryProducts.filter(product => supplierName(product) === name).length}</TableCell></TableRow>)}{!supplierNames.length && <TableRow><TableCell colSpan={2} className="py-8 text-center">No associated suppliers.</TableCell></TableRow>}</TableBody></Table>}
        </section>
      </div> : <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">{loading || !loaded ? 'Loading categories…' : 'Add a category to get started.'}</div>}
    </div>
    <Dialog open={!!editor} onOpenChange={open => { if (!open && !busy) setEditor(null); }}><DialogContent><DialogHeader><DialogTitle>{originalName ? 'Edit Category' : 'Add Category'}</DialogTitle><DialogDescription>Organize products with a unique category name and code.</DialogDescription></DialogHeader>{editor && <form onSubmit={save} className="space-y-4"><div className="space-y-2"><Label htmlFor="category-name">Category Name</Label><Input id="category-name" required value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="category-code">Category Code</Label><Input id="category-code" required placeholder="BRK, TIR, CHN" value={editor.code || ''} onChange={event => setEditor({ ...editor, code: event.target.value.toUpperCase() })} /></div><div className="space-y-2"><Label htmlFor="category-description">Description</Label><textarea id="category-description" className="min-h-24 w-full rounded-lg border bg-background p-3 text-sm" value={editor.description || ''} onChange={event => setEditor({ ...editor, description: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="category-status">Status</Label><select id="category-status" className="w-full rounded-lg border bg-background p-2 text-sm" value={editor.active === false ? 'inactive' : 'active'} onChange={event => setEditor({ ...editor, active: event.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>{actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={busy || unavailable}>{busy ? 'Saving…' : 'Save Category'}</Button></div></form>}</DialogContent></Dialog>
    <Dialog open={!!removing} onOpenChange={open => { if (!open && !busy) setRemoving(null); }}><DialogContent><DialogHeader><DialogTitle>Delete Category</DialogTitle><DialogDescription>{products.some(product => (product.category || 'Uncategorized') === removing?.name) ? 'This category still has assigned products. Reassign them in Inventory before deleting, or archive the category to preserve its assignments.' : `Permanently delete “${removing?.name}”?`}</DialogDescription></DialogHeader>{actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" disabled={busy || unavailable || products.some(product => (product.category || 'Uncategorized') === removing?.name)} onClick={remove}>{busy ? 'Deleting…' : 'Delete Category'}</Button></div></DialogContent></Dialog>
  </div>;
}

function Summary({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</div>;
}
