import { useStaffAccess } from '../hooks/useStaffAccess';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, db, onSnapshot } from '../lib/supabaseAdapter';
import { Product } from '../types';
import { handleSupabaseError, OperationType } from '../lib/supabaseErrorHandler';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Check, Download, Eye, FileText, Loader2, Pencil, Plus, RotateCcw, ScanLine, Search, Trash2, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Gemini Vision – Pricelist Image Scanner
// ---------------------------------------------------------------------------
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

async function scanPricelistImage(file: File): Promise<PricelistItem[]> {
  const toBase64 = (f: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res((r.result as string).split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(f);
    });

  const base64 = await toBase64(file);

  const prompt = `You are a pricelist data extractor. Analyze the provided pricelist image and extract all product entries.
Return ONLY a valid JSON array (no markdown fences, no explanation) with objects matching this schema:
[{ "sku": string, "name": string, "category": string, "price": number }]
Rules:
- "sku": product code. If absent, use "SKU-001", "SKU-002", etc.
- "name": product name as shown.
- "category": product group or category. If absent, use "General".
- "price": numeric value only (strip currency symbols). Use 0 if unreadable.
Return ONLY the JSON array.`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err?.error?.message || `Gemini API error: ${res.status}`);
  }

  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(clean) as Array<{ sku?: string; name?: string; category?: string; price?: number }>;

  if (!Array.isArray(parsed)) throw new Error('Unexpected response format from Gemini.');

  return parsed.map((item, i) => ({
    productId: `scan-${Date.now()}-${i}`,
    sku: String(item.sku || `SKU-${String(i + 1).padStart(3, '0')}`),
    name: String(item.name || 'Unknown Product'),
    category: String(item.category || 'General'),
    priceType: 'base' as PriceType,
    price: Number(item.price) || 0,
  }));
}

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------
type PriceType = 'base' | 'metroManila' | 'provincial' | 'promo';
interface PricelistItem { productId: string; sku: string; name: string; category: string; priceType: PriceType; price: number; }
interface SavedPricelist { id: string; name: string; createdAt: string; updatedAt?: string; lastPdfGeneratedAt?: string; items: PricelistItem[]; }
const KEY = 'activepro.savedPricelists';
const typeLabel = (type: PriceType) => type === 'metroManila' ? 'Metro Manila' : type === 'provincial' ? 'Provincial' : type === 'promo' ? 'Promo' : 'Regular';
const schemeLabel = (type: PriceType) => `${typeLabel(type)} Price`;
const price = (p: Product, type: PriceType) => Number(type === 'metroManila' ? p.mmPrice ?? p.wholesalePrice ?? 0 : type === 'provincial' ? p.provincialPrice ?? p.dealerPrice ?? 0 : type === 'promo' ? p.promoPrice ?? 0 : p.basePrice || 0);
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'emdash';
const listType = (p: SavedPricelist) => { const types = [...new Set(p.items.map(i => i.priceType))]; return types.length === 1 ? typeLabel(types[0]) : 'Mixed'; };
const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function readSaved(): SavedPricelist[] { try { const data = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(data) ? data.map((p: SavedPricelist & { exportedAt?: string; products?: Product[] }) => ({ ...p, createdAt: p.createdAt || p.exportedAt || new Date().toISOString(), items: p.items || (p.products || []).map(x => ({ productId: x.id, sku: x.sku, name: x.name, category: x.category, priceType: 'base', price: Number(x.basePrice || 0) })) })) : []; } catch { return []; } }

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Pricelist() {
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const [products, setProducts] = useState<Product[]>([]), [saved, setSaved] = useState<SavedPricelist[]>(readSaved), [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(''), [dateFilter, setDateFilter] = useState('all'), [typeFilter, setTypeFilter] = useState('all'), [pdfFilter, setPdfFilter] = useState('all');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [viewId, setViewId] = useState(''), [renameId, setRenameId] = useState(''), [rename, setRename] = useState('');
  const [createOpen, setCreateOpen] = useState(false), [name, setName] = useState(''), [productSearch, setProductSearch] = useState(''), [chosen, setChosen] = useState<Record<string, boolean>>({}), [delegated, setDelegated] = useState(false);
  const [productCategory, setProductCategory] = useState('all'), [productSupplier, setProductSupplier] = useState('all');
  const [defaultScheme, setDefaultScheme] = useState<PriceType>('base'), [categorySchemes, setCategorySchemes] = useState<Record<string, PriceType>>({}), [itemOverrides, setItemOverrides] = useState<Record<string, PriceType>>({});
  const [selectedPdfId, setSelectedPdfId] = useState('');

  // Image scan state
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanItems, setScanItems] = useState<PricelistItem[] | null>(null);
  const [scanName, setScanName] = useState('');
  const [scanPreviewUrl, setScanPreviewUrl] = useState('');

  const canEdit = permissions.pricelist === 'edit';

  useEffect(() => onSnapshot(collection(db, 'products'), s => { setProducts(s.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as Product))); setLoading(false); }, e => { handleSupabaseError(e, OperationType.GET, 'products'); setLoading(false); }), []);
  const save = (next: SavedPricelist[]) => { setSaved(next); localStorage.setItem(KEY, JSON.stringify(next)); };
  const filtered = useMemo(() => { const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), week = new Date(today), month = new Date(now.getFullYear(), now.getMonth(), 1); week.setDate(today.getDate() - today.getDay()); return saved.filter(p => { const d = new Date(p.createdAt); const dateOk = dateFilter === 'all' || (dateFilter === 'today' && d >= today) || (dateFilter === 'week' && d >= week) || (dateFilter === 'month' && d >= month) || (dateFilter === 'custom' && (!from || d >= new Date(from + 'T00:00:00')) && (!to || d <= new Date(to + 'T23:59:59'))); return p.name.toLowerCase().includes(search.toLowerCase()) && dateOk && (typeFilter === 'all' || listType(p) === typeFilter) && (pdfFilter === 'all' || (pdfFilter === 'exported' && !!p.lastPdfGeneratedAt) || (pdfFilter === 'never' && !p.lastPdfGeneratedAt)); }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }, [saved, search, dateFilter, typeFilter, pdfFilter, from, to]);
  const view = saved.find(p => p.id === viewId);
  const choices = products.filter(p => [p.sku, p.name, p.category, p.supplier].some(v => String(v || '').toLowerCase().includes(productSearch.toLowerCase())) && (productCategory === 'all' || (p.category || 'Uncategorized') === productCategory) && (productSupplier === 'all' || p.supplier === productSupplier));
  const selectedProducts = products.filter(p => chosen[p.id]);
  const grouped = selectedProducts.reduce<Record<string, Product[]>>((g, product) => { (g[product.category || 'Uncategorized'] ||= []).push(product); return g; }, {});
  const effectiveScheme = (product: Product) => itemOverrides[product.id] ?? categorySchemes[product.category || 'Uncategorized'] ?? defaultScheme;
  const closeCreate = () => { setCreateOpen(false); setName(''); setProductSearch(''); setProductCategory('all'); setProductSupplier('all'); setChosen({}); setDefaultScheme('base'); setCategorySchemes({}); setItemOverrides({}); };
  const buildPricelist = (): SavedPricelist => ({ id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), items: selectedProducts.map(x => { const priceType = effectiveScheme(x); return { productId: x.id, sku: x.sku, name: x.name, category: x.category || 'Uncategorized', priceType, price: price(x, priceType) }; }) });
  const create = (draft = false) => { if (!name.trim() || !selectedProducts.length) return; const p = buildPricelist(); save([p, ...saved]); closeCreate(); toast.success(draft ? `"${p.name}" saved as draft` : `"${p.name}" saved successfully`); };
  const generatePdf = (target = view) => { if (!target) return; const rows = target.items.map(i => `<tr><td>${escapeHtml(i.sku)}</td><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.category)}</td><td>${schemeLabel(i.priceType)}</td><td>P${i.price.toLocaleString()}</td></tr>`).join(''); const w = window.open('', '_blank'); if (!w) return toast.error('Allow pop-ups to preview this pricelist PDF'); w.document.write(`<html><head><title>${escapeHtml(target.name)}</title><style>body{font-family:Arial;padding:32px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#111827;color:white}</style></head><body><h1>${escapeHtml(target.name)}</h1><p>Date Created: ${dateLabel(target.createdAt)}</p><table><thead><tr><th>SKU</th><th>Item Name</th><th>Category</th><th>Price Scheme</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table></body></html>`); w.document.close(); save(saved.map(p => p.id === target.id ? { ...p, lastPdfGeneratedAt: new Date().toISOString() } : p)); };
  const doRename = () => { if (!rename.trim()) return; save(saved.map(p => p.id === renameId ? { ...p, name: rename.trim(), updatedAt: new Date().toISOString() } : p)); setRenameId(''); toast.success('Pricelist renamed'); };
  const remove = (p: SavedPricelist) => { if (window.confirm(`Delete "${p.name}"? This action cannot be undone.`)) { save(saved.filter(x => x.id !== p.id)); toast.success('Pricelist deleted'); } };

  // Image scan handlers
  const handleScanClick = () => scanInputRef.current?.click();
  const handleScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file.'); return; }
    setScanPreviewUrl(URL.createObjectURL(file));
    setScanName(`Scanned Pricelist - ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
    setScanning(true);
    try {
      const items = await scanPricelistImage(file);
      if (!items.length) { toast.error('No products found in the image. Try a clearer photo.'); setScanning(false); return; }
      setScanItems(items);
      toast.success(`${items.length} products extracted from image.`);
    } catch (err) {
      toast.error(`Scan failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setScanning(false);
      if (scanInputRef.current) scanInputRef.current.value = '';
    }
  };
  const confirmScan = () => {
    if (!scanItems?.length || !scanName.trim()) return;
    const p: SavedPricelist = { id: crypto.randomUUID(), name: scanName.trim(), createdAt: new Date().toISOString(), items: scanItems };
    save([p, ...saved]);
    toast.success(`"${p.name}" saved successfully`);
    setScanItems(null);
    setScanPreviewUrl('');
    setScanName('');
  };
  const cancelScan = () => { setScanItems(null); setScanPreviewUrl(''); setScanName(''); };

  if (loading) return <div className="flex min-h-[400px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin"/></div>;
  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="mt-1 text-sm text-muted-foreground">Create and manage saved pricelists using products from Inventory.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!selectedPdfId} onClick={() => generatePdf(saved.find(p => p.id === selectedPdfId))}><Download className="mr-2 h-4 w-4"/>Generate PDF</Button>
          {canEdit && (
            <>
              <Button variant="outline" onClick={handleScanClick} disabled={scanning}>
                {scanning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Scanning...</> : <><ScanLine className="mr-2 h-4 w-4"/>Scan Image</>}
              </Button>
              <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4"/>Create Pricelist</Button>
            </>
          )}
        </div>
      </div>

      <input ref={scanInputRef} type="file" accept="image/*" className="hidden" onChange={handleScanFile}/>

      <div className="rounded-2xl border bg-card p-4"><div className="grid gap-3 md:grid-cols-4"><div><label className="text-xs invisible select-none block">Search</label><div className="relative mt-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"/><Input className="pl-9" placeholder="Search by pricelist name..." value={search} onChange={e => setSearch(e.target.value)}/></div></div><Filter label="Date Created" value={dateFilter} set={setDateFilter} options={[["all","All Dates"],["today","Today"],["week","This Week"],["month","This Month"],["custom","Custom Date Range"]]}/><Filter label="Pricelist Type" value={typeFilter} set={setTypeFilter} options={[["all","All Types"],["Regular","Regular"],["Metro Manila","Metro Manila"],["Provincial","Provincial"],["Promo","Promo"],["Mixed","Mixed"]]}/><Filter label="PDF Status" value={pdfFilter} set={setPdfFilter} options={[["all","All Statuses"],["never","Never Exported"],["exported","Exported"]]}/></div>{dateFilter === 'custom' && <div className="mt-3 grid grid-cols-2 gap-3"><Field label="From" value={from} set={setFrom}/><Field label="To" value={to} set={setTo}/></div>}</div>

      <div className="overflow-x-auto rounded-2xl border"><Table><TableHeader><TableRow><TableHead className="w-12"/><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Items</TableHead><TableHead>Date Created</TableHead><TableHead>Last PDF Generated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filtered.map(p => <TableRow key={p.id}><TableCell><input type="checkbox" checked={selectedPdfId === p.id} onChange={e => setSelectedPdfId(e.target.checked ? p.id : '')}/></TableCell><TableCell><span className="flex items-center gap-2 font-bold"><FileText className="h-5 w-5"/>{p.name}</span></TableCell><TableCell>{listType(p)}</TableCell><TableCell>{p.items.length}</TableCell><TableCell>{dateLabel(p.createdAt)}</TableCell><TableCell>{dateLabel(p.lastPdfGeneratedAt)}</TableCell><TableCell><div className="flex justify-end gap-2"><Icon title="View" onClick={() => setViewId(p.id)}><Eye/></Icon>{canEdit && <><Icon title="Rename" onClick={() => { setRenameId(p.id); setRename(p.name); }}><Pencil/></Icon><Icon title="Delete" danger onClick={() => remove(p)}><Trash2/></Icon></>}</div></TableCell></TableRow>)}{!filtered.length && <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground">No saved pricelists match the selected filters.</TableCell></TableRow>}</TableBody></Table></div>

      <Dialog open={!!view} onOpenChange={o => !o && setViewId('')}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>{view?.name}</DialogTitle><DialogDescription>{view && `${view.items.length} items - Created ${dateLabel(view.createdAt)}`}</DialogDescription></DialogHeader><Items items={view?.items || []}/><DialogFooter><Button variant="outline" onClick={() => setViewId('')}>Close</Button><Button onClick={() => generatePdf()}><Download className="mr-2 h-4 w-4"/>Generate PDF</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!renameId && canEdit} onOpenChange={o => !o && setRenameId('')}><DialogContent><DialogHeader><DialogTitle>Rename Pricelist</DialogTitle></DialogHeader><Label>Pricelist Name</Label><Input value={rename} onChange={e => setRename(e.target.value)}/><DialogFooter><Button variant="outline" onClick={() => setRenameId('')}>Cancel</Button><Button onClick={doRename}>Rename</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!scanItems} onOpenChange={o => !o && cancelScan()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5"/>Review Scanned Pricelist</DialogTitle>
            <DialogDescription>{scanItems?.length ?? 0} products extracted. Review and name the pricelist before saving.</DialogDescription>
          </DialogHeader>
          {scanPreviewUrl && (
            <div className="overflow-hidden rounded-xl border">
              <img src={scanPreviewUrl} alt="Scanned pricelist" className="max-h-52 w-full object-contain bg-muted"/>
            </div>
          )}
          <div className="space-y-2">
            <Label>Pricelist Name</Label>
            <Input value={scanName} onChange={e => setScanName(e.target.value)} placeholder="Enter a name for this pricelist"/>
          </div>
          <Items items={scanItems || []}/>
          <DialogFooter>
            <Button variant="outline" onClick={cancelScan}>Cancel</Button>
            <Button onClick={confirmScan} disabled={!scanName.trim() || !scanItems?.length}><Check className="mr-2 h-4 w-4"/>Save Pricelist</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Builder open={createOpen && canEdit} close={closeCreate} name={name} setName={setName} products={products} choices={choices} chosen={chosen} setChosen={setChosen} search={productSearch} setSearch={setProductSearch} category={productCategory} setCategory={setProductCategory} supplier={productSupplier} setSupplier={setProductSupplier} grouped={grouped} defaultScheme={defaultScheme} setDefaultScheme={setDefaultScheme} categorySchemes={categorySchemes} setCategorySchemes={setCategorySchemes} itemOverrides={itemOverrides} setItemOverrides={setItemOverrides} saveDraft={() => create(true)} savePricelist={() => create(false)} preview={() => generatePdf(buildPricelist())}/>
    </div>
  );
}

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
interface BuilderProps { open:boolean; close:()=>void; name:string; setName:(v:string)=>void; products:Product[]; choices:Product[]; chosen:Record<string,boolean>; setChosen:Setter<Record<string,boolean>>; search:string; setSearch:(v:string)=>void; category:string; setCategory:(v:string)=>void; supplier:string; setSupplier:(v:string)=>void; grouped:Record<string,Product[]>; defaultScheme:PriceType; setDefaultScheme:(v:PriceType)=>void; categorySchemes:Record<string,PriceType>; setCategorySchemes:Setter<Record<string,PriceType>>; itemOverrides:Record<string,PriceType>; setItemOverrides:Setter<Record<string,PriceType>>; saveDraft:()=>void; savePricelist:()=>void; preview:()=>void; }
function Builder(p: BuilderProps) {
  const categories = [...new Set(p.products.map(x => x.category || 'Uncategorized'))].sort(), suppliers = [...new Set(p.products.map(x => x.supplier).filter(Boolean) as string[])].sort();
  const count = Object.keys(p.chosen).length, ready = !!p.name.trim() && count > 0;
  const selectedProducts = p.products.filter(x => p.chosen[x.id]);
  const removeItem = (id:string) => { p.setChosen(c => { const n={...c}; delete n[id]; return n; }); p.setItemOverrides(o => { const n={...o}; delete n[id]; return n; }); };
  return <Dialog open={p.open} onOpenChange={o => !o && p.close()}><DialogContent className="max-h-[94vh] w-[94vw] max-w-[94vw] overflow-y-auto p-0 sm:!max-w-[94vw] lg:!max-w-6xl">
    <div className="sticky top-0 z-20 flex flex-col justify-between gap-4 border-b bg-background px-6 py-4 lg:flex-row lg:items-center"><div><DialogTitle>Create Pricelist</DialogTitle><DialogDescription>Build a new pricelist from your Inventory products.</DialogDescription></div><Steps/></div>
    <div className="space-y-5 px-6"><section className="rounded-xl border p-4"><h3 className="mb-4 text-sm font-bold">Pricelist Information</h3><div className="grid gap-4 md:grid-cols-2"><div><Label>Pricelist Name</Label><Input className="mt-2" value={p.name} onChange={e => p.setName(e.target.value)} placeholder="Enter pricelist name"/></div><div><Label>Default Price Scheme</Label><Scheme value={p.defaultScheme} promo={count > 0 && selectedProducts.every(x => x.promoPrice != null)} onChange={p.setDefaultScheme}/><p className="mt-1 text-xs text-muted-foreground">Applies to all products unless overridden per category or item.</p></div></div></section>
    <section id="add-pricelist-products" className="rounded-xl border p-4"><div className="mb-4 flex justify-between"><h3 className="text-sm font-bold">Add Products</h3><Button size="sm" onClick={() => p.setChosen(c => { const n={...c}; p.choices.forEach(x => n[x.id]=true); return n; })}><Plus className="mr-2 h-4 w-4"/>{count ? 'Add More Products' : 'Add Products'}</Button></div><div className="grid gap-3 md:grid-cols-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"/><Input className="pl-9" placeholder="Search by name, SKU..." value={p.search} onChange={e => p.setSearch(e.target.value)}/></div><SimpleSelect value={p.category} onChange={p.setCategory} label="All Categories" values={categories}/><SimpleSelect value={p.supplier} onChange={p.setSupplier} label="All Suppliers" values={suppliers}/></div><div className="mt-3 max-h-40 overflow-y-auto rounded-lg border"><Table><TableBody>{p.choices.map(x => <TableRow key={x.id}><TableCell className="w-12"><input type="checkbox" checked={!!p.chosen[x.id]} onChange={e => e.target.checked ? p.setChosen(c => ({...c,[x.id]:true})) : removeItem(x.id)}/></TableCell><TableCell className="font-mono text-xs">{x.sku}</TableCell><TableCell className="font-medium">{x.name}</TableCell><TableCell>{x.category || 'Uncategorized'}</TableCell></TableRow>)}</TableBody></Table></div></section>
    <div className="flex flex-wrap justify-between gap-3"><div><b className="text-sm">Selected Products <span className="rounded-full bg-muted px-2 py-1 text-xs">{count} items</span></b><p className="mt-1 text-xs text-muted-foreground">Prices are read-only and retrieved from Inventory / Product Pricing.</p></div><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={!count} onClick={() => {p.setChosen({});p.setCategorySchemes({});p.setItemOverrides({});}}><Trash2 className="mr-2 h-4 w-4"/>Remove All</Button><Button variant="outline" size="sm" disabled={!count} onClick={() => {p.setCategorySchemes({});p.setItemOverrides({});}}><RotateCcw className="mr-2 h-4 w-4"/>Apply Default to All</Button></div></div>
    {Object.entries(p.grouped).map(([category,items]) => { const cs=p.categorySchemes[category]??p.defaultScheme, mixed=items.some(x => p.itemOverrides[x.id]!=null && p.itemOverrides[x.id]!==cs); return <section key={category} className="overflow-hidden rounded-xl border"><div className="flex flex-col justify-between gap-3 border-b bg-muted/30 px-4 py-3 md:flex-row md:items-center"><b>{category} <span className="text-xs font-normal text-muted-foreground">{items.length} items</span></b><div className="flex flex-wrap items-center gap-2"><Label className="text-xs">Category Price Scheme</Label><Scheme value={cs} display={mixed?'Mixed Price Scheme':undefined} promo={items.every(x=>x.promoPrice!=null)} onChange={v=>p.setCategorySchemes(s=>({...s,[category]:v}))}/>{p.categorySchemes[category]&&<Button variant="ghost" size="icon" title="Reset Category Override" aria-label={`Reset price scheme for ${category}`} onClick={()=>p.setCategorySchemes(s=>{const n={...s};delete n[category];return n;})}><RotateCcw className="h-4 w-4"/></Button>}</div></div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Item Name</TableHead><TableHead>Supplier</TableHead><TableHead>Price Scheme</TableHead><TableHead className="text-right">Price</TableHead><TableHead/></TableRow></TableHeader><TableBody>{items.map(x=>{const s=p.itemOverrides[x.id]??cs;return <TableRow key={x.id}><TableCell className="font-mono text-xs">{x.sku}</TableCell><TableCell className="font-medium">{x.name}</TableCell><TableCell>{x.supplier||'---'}</TableCell><TableCell><div className="flex items-center gap-1"><Scheme value={s} promo={x.promoPrice!=null} onChange={v=>p.setItemOverrides(o=>({...o,[x.id]:v}))}/>{p.itemOverrides[x.id]&&<Button variant="ghost" size="icon" title="Reset Item Override" onClick={()=>p.setItemOverrides(o=>{const n={...o};delete n[x.id];return n;})}><RotateCcw className="h-4 w-4"/></Button>}</div></TableCell><TableCell className="text-right font-bold">P{price(x,s).toLocaleString()}</TableCell><TableCell><Button variant="ghost" size="icon" title="Remove from pricelist" onClick={()=>removeItem(x.id)}><X className="h-4 w-4"/></Button></TableCell></TableRow>})}</TableBody></Table></div></section>})}
    {!count&&<div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">Select products above to configure their price schemes.</div>}</div>
    <DialogFooter className="sticky bottom-0 z-20 border-t bg-background px-6 py-4"><Button variant="outline" onClick={p.close}>Cancel</Button><Button variant="outline" disabled={!ready} onClick={p.saveDraft}>Save Draft</Button><Button disabled={!ready} onClick={p.savePricelist}>Save Pricelist</Button><Button disabled={!ready} onClick={p.preview}><Eye className="mr-2 h-4 w-4"/>Preview PDF</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function Steps(){return <div className="flex items-center gap-2 text-xs"><span className="flex items-center gap-2"><i className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3"/></i>Add Products</span><i className="h-px w-7 bg-border"/><span className="flex items-center gap-2 font-bold"><i className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">2</i>Configure and Review</span><i className="h-px w-7 bg-border"/><span className="flex items-center gap-2 text-muted-foreground"><i className="grid h-6 w-6 place-items-center rounded-full bg-muted">3</i>Preview PDF</span></div>}
function Scheme({value,onChange,promo=false,display}:{value:PriceType;onChange:(v:PriceType)=>void;promo?:boolean;display?:string}){const values:PriceType[]=['base','metroManila','provincial',...(promo?['promo' as PriceType]:[])];return <Select value={value} onValueChange={v=>v&&onChange(v as PriceType)}><SelectTrigger className="mt-2 w-52"><SelectValue>{display||schemeLabel(value)}</SelectValue></SelectTrigger><SelectContent>{values.map(v=><SelectItem key={v} value={v}>{schemeLabel(v)}</SelectItem>)}</SelectContent></Select>}
function SimpleSelect({value,onChange,label,values}:{value:string;onChange:(v:string)=>void;label:string;values:string[]}){return <Select value={value} onValueChange={v=>v&&onChange(v)}><SelectTrigger><SelectValue>{value==='all'?label:value}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">{label}</SelectItem>{values.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>}
function Filter({label,value,set,options}:{label:string;value:string;set:(v:string)=>void;options:string[][]}){return <div><Label className="text-xs">{label}</Label><Select value={value} onValueChange={v=>v&&set(v)}><SelectTrigger className="mt-1"><SelectValue>{options.find(x=>x[0]===value)?.[1]}</SelectValue></SelectTrigger><SelectContent>{options.map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>}
function Field({label,value,set}:{label:string;value:string;set:(v:string)=>void}){return <div><Label>{label}</Label><Input type="date" value={value} onChange={e=>set(e.target.value)}/></div>}
function Icon({title,onClick,danger,children}:{title:string;onClick:()=>void;danger?:boolean;children:React.ReactElement}){return <Button variant="outline" size="icon" title={title} onClick={onClick} className={danger?'text-destructive':''}>{React.cloneElement(children,{className:'h-4 w-4'} as React.HTMLAttributes<HTMLElement>)}</Button>}
function Items({items}:{items:PricelistItem[]}){return <div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Item Name</TableHead><TableHead>Category</TableHead><TableHead>Price Scheme</TableHead><TableHead className="text-right">Price</TableHead></TableRow></TableHeader><TableBody>{items.map((i,idx)=><TableRow key={`${i.productId}-${idx}`}><TableCell>{i.sku}</TableCell><TableCell>{i.name}</TableCell><TableCell>{i.category}</TableCell><TableCell>{schemeLabel(i.priceType)}</TableCell><TableCell className="text-right font-bold">P{i.price.toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></div>}
