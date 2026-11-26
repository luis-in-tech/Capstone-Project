import { SearchBar } from '@/components/ui/search-bar';
import { hasAdminRole } from '../lib/staffPermissions';
import { memo, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon as Plus, PencilIcon as Pencil, ArchiveIcon as Archive, TrashIcon as Trash2 } from '@phosphor-icons/react';
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
const CATEGORY_PRODUCTS_PAGE_SIZE = 50;
const money = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);

export const CategoryWorkspace = memo(function CategoryWorkspace({ products, inventory, warehouses, suppliers, loading, error, onRetry }: Props) {
  const { profile } = useAuth();
  const isAdmin = hasAdminRole(profile);
  const [records, setRecords] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selectedName, setSelectedName] = useState('');
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [section, setSection] = useState<'products' | 'warehouses' | 'suppliers'>('products');
  const [editor, setEditor] = useState<Category | null>(null);
  const [originalName, setOriginalName] = useState('');
  const [removing, setRemoving] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    setLoaded(false); setLoadError(false);
    return onSnapshot(collection(db, 'productCategories'), snap => {
      setRecords(snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Category)));
      setLoaded(true); setLoadError(false);
    }, () => { setLoaded(true); setLoadError(true); });
  }, [reload]);

  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s.name])), [suppliers]);
  const warehouseById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses]);

  const { categories, productsByCategory } = useMemo(() => {
    const byCat = new Map<string, Product[]>();
    const existingNames = new Set(records.map(r => r.name));
    const list = [...records];
    for (const product of products) {
      const name = product.category || 'Uncategorized';
      let bucket = byCat.get(name);
      if (!bucket) {
        bucket = [];
        byCat.set(name, bucket);
      }
      bucket.push(product);
      if (!existingNames.has(name)) {
        existingNames.add(name);
        list.push({ id: '', name, active: true });
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return { categories: list, productsByCategory: byCat };
  }, [records, products]);

  const visibleCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter(category =>
      [category.name, category.code || ''].some(value => value.toLowerCase().includes(query))
    );
  }, [categories, search]);

  const current = useMemo(
    () => categories.find(category => category.name === selectedName) || categories[0],
    [categories, selectedName]
  );

  const unavailable = loading || !loaded || error || loadError;

  const { stockByProduct, inventoryByProduct } = useMemo(() => {
    const sumMap = new Map<string, number>();
    const listMap = new Map<string, InventoryItem[]>();
    for (const item of inventory) {
      sumMap.set(item.productId, (sumMap.get(item.productId) || 0) + item.quantity);
      let bucket = listMap.get(item.productId);
      if (!bucket) {
        bucket = [];
        listMap.set(item.productId, bucket);
      }
      bucket.push(item);
    }
    return { stockByProduct: sumMap, inventoryByProduct: listMap };
  }, [inventory]);

  const categoryProducts = useMemo(
    () => (current?.name ? productsByCategory.get(current.name) || [] : []),
    [productsByCategory, current?.name]
  );

  const { totalUnits, lowStockCount, missingCosts, valuation, supplierCounts, supplierNames, warehouseUnitsById, warehouseRowIds } = useMemo(() => {
    let unitsTotal = 0;
    let lowCount = 0;
    let missing = false;
    let val = 0;
    const supCounts = new Map<string, number>();
    const whUnits = new Map<string, number>();
    for (const product of categoryProducts) {
      const u = stockByProduct.get(product.id) || 0;
      unitsTotal += u;
      if (u <= (product.minStockLevel || 0)) lowCount += 1;
      if (u !== 0 && product.costPrice == null) missing = true;
      val += u * (product.costPrice ?? 0);
      const sName = (product.supplierId ? supplierById.get(product.supplierId) : undefined) || product.supplier || 'N/A';
      if (sName !== 'N/A' && sName.trim()) {
        supCounts.set(sName, (supCounts.get(sName) || 0) + 1);
      }
      const rows = inventoryByProduct.get(product.id) || [];
      for (const item of rows) {
        whUnits.set(item.warehouseId, (whUnits.get(item.warehouseId) || 0) + item.quantity);
      }
    }
    const supNames = Array.from(supCounts.keys()).sort();
    const whIdSet = new Set<string>(warehouses.map(w => w.id));
    for (const wId of whUnits.keys()) whIdSet.add(wId);
    return {
      totalUnits: unitsTotal,
      lowStockCount: lowCount,
      missingCosts: missing,
      valuation: val,
      supplierCounts: supCounts,
      supplierNames: supNames,
      warehouseUnitsById: whUnits,
      warehouseRowIds: Array.from(whIdSet),
    };
  }, [categoryProducts, stockByProduct, supplierById, inventoryByProduct, warehouses]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return categoryProducts;
    return categoryProducts.filter(product => {
      const sName = (product.supplierId ? supplierById.get(product.supplierId) : undefined) || product.supplier || 'N/A';
      return [product.sku, product.name, sName].some(value => (value || '').toLowerCase().includes(query));
    });
  }, [categoryProducts, productSearch, supplierById]);

  const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / CATEGORY_PRODUCTS_PAGE_SIZE));
  const safeProductPage = Math.min(productPage, totalProductPages);
  const pagedProducts = useMemo(() => {
    const start = (safeProductPage - 1) * CATEGORY_PRODUCTS_PAGE_SIZE;
    return filteredProducts.slice(start, start + CATEGORY_PRODUCTS_PAGE_SIZE);
  }, [filteredProducts, safeProductPage]);

  const startEdit = (category?: Category) => {
    if (!isAdmin) return;
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
    if (!isAdmin || !editor || busy || unavailable) return;
    const name = editor.name.trim(), code = editor.code?.trim().toUpperCase();
    if (!name || !code) { setActionError('Category name and code are required.'); return; }
    if (categories.some(category => category.name !== originalName && (category.name.toLowerCase() === name.toLowerCase() || (category.code && category.code.toUpperCase() === code)))) {
      setActionError('A category with that name or code already exists.'); return;
    }
    setBusy(true); setActionError('');
    let createdLegacyId = '';
    try {
      // Materialize legacy categories first so database rename protection can update assignments atomically.
      let id = editor.id;
      if (!id && originalName && name !== originalName) {
        const created = await addDoc(collection(db, 'productCategories'), { name: originalName, createdAt: serverTimestamp() });
        id = created.id;
        createdLegacyId = created.id;
      }
      await persist({ ...editor, id, name, code });
      setSelectedName(name); setEditor(null); toast.success('Category saved');
    } catch (err) {
      if (createdLegacyId) {
        await deleteDoc(doc(db, 'productCategories', createdLegacyId)).catch(() => {});
      }
      setActionError(err instanceof Error ? err.message : (err as { message?: string })?.message || 'Could not save category.');
    }
    finally { setBusy(false); }
  };
  const archive = async () => {
    if (!isAdmin || !current || unavailable || busy) return;
    setBusy(true);
    try { await persist({ ...current, active: current.active === false }); toast.success(current.active === false ? 'Category activated' : 'Category archived'); }
    catch { toast.error('Could not change category status.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!isAdmin || !removing || unavailable || busy) return;
    if ((productsByCategory.get(removing.name)?.length ?? 0) > 0) { setActionError('Reassign all products before deleting this category.'); return; }
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
        <div className="space-y-3 border-b p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Categories</h2>{isAdmin && <Button size="sm" disabled={unavailable || busy} onClick={() => startEdit()}><Plus className="size-4" />Add Category</Button>}</div><SearchBar aria-label="Search categories by name or code" placeholder="Search name or code…" value={search} onValueChange={setSearch} /></div>
        <div className="max-h-160 overflow-y-auto p-2">
          {visibleCategories.map(category => <button type="button" key={category.id || category.name} aria-pressed={current?.name === category.name} onClick={() => { setSelectedName(category.name); setProductSearch(''); setProductPage(1); setSection('products'); }} className={`mb-1 w-full rounded-xl border p-3 text-left ${current?.name === category.name ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}><span className="block font-semibold">{category.name}</span><span className="block text-xs text-muted-foreground">{category.code || 'No code'} · {category.active === false ? 'Inactive' : 'Active'} · {productsByCategory.get(category.name)?.length || 0} products</span></button>)}
          {!visibleCategories.length && <p className="p-6 text-center text-sm text-muted-foreground">{loading || !loaded ? 'Loading categories…' : 'No categories found.'}</p>}
        </div>
      </aside>
      {current ? <div className="min-w-0 space-y-5">
        <section className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><Badge variant="secondary">{current.active === false ? 'Inactive' : 'Active'}</Badge><h2 className="mt-2 text-xl font-bold">{current.name}</h2><p className="text-sm text-muted-foreground">{current.code || 'No category code'}</p></div>{isAdmin && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={unavailable || busy} onClick={() => startEdit(current)}><Pencil className="size-4" />Edit</Button><Button size="sm" variant="outline" disabled={unavailable || busy} onClick={archive}><Archive className="size-4" />{current.active === false ? 'Activate' : 'Archive'}</Button><Button size="sm" variant="ghost" disabled={unavailable || busy || !current.id} onClick={() => { setRemoving(current); setActionError(''); }}><Trash2 className="size-4" />Delete</Button></div>}</div><p className="mt-4 text-sm text-muted-foreground">{current.description || 'No description provided.'}</p></section>
        <div className={`grid gap-3 sm:grid-cols-2 ${hasAdminRole(profile) ? '2xl:grid-cols-4' : '2xl:grid-cols-3'}`}>
          <Summary label="Products" value={unavailable ? '—' : categoryProducts.length.toLocaleString()} />
          <Summary label="Units in stock" value={unavailable ? '—' : totalUnits.toLocaleString()} />
          <Summary label="Low-stock products" value={unavailable ? '—' : lowStockCount.toLocaleString()} note="At or below minimum stock, including out of stock" />
          {hasAdminRole(profile) && <Summary label="Inventory valuation" value={unavailable || missingCosts ? 'Unavailable' : money(valuation)} note={missingCosts ? 'Some products are missing cost prices' : 'At product cost · Admin only'} />}
        </div>
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex gap-2 border-b p-3" role="group" aria-label="Category details">{(['products', 'warehouses', 'suppliers'] as const).map(tab => <Button key={tab} variant={section === tab ? 'default' : 'ghost'} aria-pressed={section === tab} onClick={() => setSection(tab)} className="capitalize">{tab}</Button>)}</div>
          {unavailable ? <p className="p-6 text-sm text-muted-foreground">{error || loadError ? 'Records unavailable.' : 'Loading records…'}</p> : section === 'products' ? <>
            <div className="flex flex-wrap gap-3 p-4"><SearchBar containerClassName="min-w-48 flex-1" aria-label="Search category products" placeholder="Search SKU, product, or supplier…" value={productSearch} onValueChange={v => { setProductSearch(v); setProductPage(1); }} /><Link className="inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted" to={`/inventory?category=${encodeURIComponent(current.name)}`}>View in Inventory</Link></div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product Name</TableHead><TableHead className="text-right">Total Stock</TableHead></TableRow></TableHeader><TableBody>{pagedProducts.map(product => <TableRow key={product.id}><TableCell className="font-mono text-xs">{product.sku}</TableCell><TableCell><Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/inventory?product=${encodeURIComponent(product.id)}`}>{product.name}</Link></TableCell><TableCell className="text-right">{(stockByProduct.get(product.id) || 0).toLocaleString()}</TableCell></TableRow>)}{!filteredProducts.length && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No products found.</TableCell></TableRow>}</TableBody></Table></div>
            {totalProductPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
                <span>Showing {((safeProductPage - 1) * CATEGORY_PRODUCTS_PAGE_SIZE + 1).toLocaleString()}–{Math.min(safeProductPage * CATEGORY_PRODUCTS_PAGE_SIZE, filteredProducts.length).toLocaleString()} of {filteredProducts.length.toLocaleString()} products</span>
                <div className="flex items-center gap-1.5">
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={safeProductPage <= 1} onClick={() => setProductPage(p => Math.max(1, p - 1))}>Prev</Button>
                  <span className="tabular-nums">Page {safeProductPage} of {totalProductPages}</span>
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={safeProductPage >= totalProductPages} onClick={() => setProductPage(p => Math.min(totalProductPages, p + 1))}>Next</Button>
                </div>
              </div>
            )}
          </> : section === 'warehouses' ? <Table><TableHeader><TableRow><TableHead>Warehouse</TableHead><TableHead className="text-right">Units in stock</TableHead></TableRow></TableHeader><TableBody>{warehouseRowIds.map(id => <TableRow key={id}><TableCell>{warehouseById.get(id)?.name || 'Unknown warehouse'}</TableCell><TableCell className="text-right">{(warehouseUnitsById.get(id) || 0).toLocaleString()}</TableCell></TableRow>)}{warehouseRowIds.length === 0 && <TableRow><TableCell colSpan={2} className="py-8 text-center">No warehouse records.</TableCell></TableRow>}</TableBody></Table> : <Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className="text-right">Products in category</TableHead></TableRow></TableHeader><TableBody>{supplierNames.map(name => <TableRow key={name}><TableCell>{name}</TableCell><TableCell className="text-right">{supplierCounts.get(name) || 0}</TableCell></TableRow>)}{!supplierNames.length && <TableRow><TableCell colSpan={2} className="py-8 text-center">No associated suppliers.</TableCell></TableRow>}</TableBody></Table>}
        </section>
      </div> : <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">{loading || !loaded ? 'Loading categories…' : 'Add a category to get started.'}</div>}
    </div>
    <Dialog open={!!editor} onOpenChange={open => { if (!open && !busy) setEditor(null); }}><DialogContent><DialogHeader><DialogTitle>{originalName ? 'Edit Category' : 'Add Category'}</DialogTitle><DialogDescription>Organize products with a unique category name and code.</DialogDescription></DialogHeader>{editor && <form onSubmit={save} className="space-y-4"><div className="space-y-2"><Label htmlFor="category-name">Category Name</Label><Input id="category-name" required value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="category-code">Category Code</Label><Input id="category-code" required placeholder="BRK, TIR, CHN" value={editor.code || ''} onChange={event => setEditor({ ...editor, code: event.target.value.toUpperCase() })} /></div><div className="space-y-2"><Label htmlFor="category-description">Description</Label><textarea id="category-description" className="min-h-24 w-full rounded-lg border bg-background p-3 text-sm" value={editor.description || ''} onChange={event => setEditor({ ...editor, description: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="category-status">Status</Label><select id="category-status" className="w-full rounded-lg border bg-background p-2 text-sm" value={editor.active === false ? 'inactive' : 'active'} onChange={event => setEditor({ ...editor, active: event.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>{actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" disabled={busy || unavailable}>{busy ? 'Saving…' : 'Save Category'}</Button></div></form>}</DialogContent></Dialog>
    <Dialog open={!!removing} onOpenChange={open => { if (!open && !busy) setRemoving(null); }}><DialogContent><DialogHeader><DialogTitle>Delete Category</DialogTitle><DialogDescription>{removing && (productsByCategory.get(removing.name)?.length ?? 0) > 0 ? 'This category still has assigned products. Reassign them in Inventory before deleting, or archive the category to preserve its assignments.' : `Permanently delete “${removing?.name}”?`}</DialogDescription></DialogHeader>{actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="destructive" disabled={busy || unavailable || !removing || (productsByCategory.get(removing.name)?.length ?? 0) > 0} onClick={remove}>{busy ? 'Deleting…' : 'Delete Category'}</Button></div></DialogContent></Dialog>
  </div>;
});

function Summary({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</div>;
}
