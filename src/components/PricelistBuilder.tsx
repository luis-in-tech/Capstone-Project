import { useState } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { TriangleAlert } from 'lucide-react';
import { Product } from '../types';
import { PricelistItem, PricelistSection, PriceType, SavedPricelist, reorder, sectionsFor } from '../lib/pricelistSections';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const labels: Record<PriceType, string> = { base: 'Regular', metroManila: 'Metro Manila', provincial: 'Provincial', promo: 'Promo' };
const productPrice = (p: Product, type: PriceType) => Number(type === 'metroManila' ? p.mmPrice ?? p.wholesalePrice ?? 0 : type === 'provincial' ? p.provincialPrice ?? p.dealerPrice ?? 0 : type === 'promo' ? p.promoPrice ?? 0 : p.basePrice || 0);
const selectClass = 'rounded-md border bg-background p-2 text-sm';

function MixedPricing({ sections, baseline, scope }: { sections: PricelistSection[]; baseline: PriceType; scope: 'master' | 'section' }) {
  const differences = sections.flatMap(section => section.items
    .filter(item => item.priceType !== baseline)
    .map(item => ({ section: section.name || 'Untitled section', item })));
  if (!differences.length) return null;

  return <Tooltip.Provider><Tooltip.Root>
    <Tooltip.Trigger type="button" delay={150} aria-label={`Mixed pricing: ${differences.length} products differ from the ${scope} price scheme`}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-amber-700 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring dark:text-amber-400">
      <TriangleAlert className="h-4 w-4" aria-hidden="true" />Mixed pricing
    </Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Positioner side="bottom" align="start" sideOffset={6} className="z-[100]">
      <Tooltip.Popup className="max-h-72 w-80 max-w-[90vw] overflow-y-auto rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md">
        <p className="font-semibold">Different from {scope} pricing ({labels[baseline]})</p>
        <ul className="mt-2 space-y-2">{differences.map(({ section, item }, index) => <li key={`${item.productId}-${index}`} className="break-words">
          {scope === 'master' && <span className="block text-xs text-muted-foreground">{section}</span>}
          <span>{item.name} ({item.sku}) — <b>{labels[item.priceType]}</b></span>
        </li>)}</ul>
      </Tooltip.Popup>
    </Tooltip.Positioner></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

function PriceSelect({ value, onChange, inherit, promo }: { value?: PriceType; onChange: (value?: PriceType) => void; inherit?: string; promo: boolean }) {
  return <select aria-label={inherit ? `Price scheme (${inherit})` : 'Master price scheme'} className={selectClass} value={value || ''} onChange={e => onChange((e.target.value || undefined) as PriceType | undefined)}>
    {inherit && <option value="">{inherit}</option>}
    {Object.entries(labels).filter(([key]) => key !== 'promo' || promo || value === 'promo').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
  </select>;
}

export function PricelistBuilder({ initial, products, stockMap, close, save, preview }: {
  initial?: SavedPricelist; products: Product[]; stockMap: Record<string, number>; close: () => void;
  save: (list: SavedPricelist, draft: boolean) => Promise<void>; preview: (list: SavedPricelist) => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [master, setMaster] = useState<PriceType>(initial?.defaultScheme || 'base');
  const [sections, setSections] = useState<PricelistSection[]>(() => initial ? sectionsFor(initial) : []);
  const [heading, setHeading] = useState('');
  const [sourceCategory, setSourceCategory] = useState('');
  const [activeId, setActiveId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const categories = [...new Set(products.map(p => p.category || 'Uncategorized'))].sort();
  const active = sections.find(s => s.id === activeId);
  const patch = (id: string, update: Partial<PricelistSection>) => setSections(old => old.map(s => s.id === id ? { ...s, ...update } : s));
  const toItem = (p: Product): PricelistItem => ({ productId: p.id, sku: p.sku, name: p.name, category: p.category || 'Uncategorized', priceType: master, price: productPrice(p, master) });
  const openPicker = (id: string, filter = '') => { setActiveId(id); setCategory(filter); setSearch(''); setSelected([]); };
  const addSection = (all = false) => {
    if (!heading.trim()) return;
    const section = { id: crypto.randomUUID(), name: heading.trim(), items: all ? products.filter(p => (p.category || 'Uncategorized') === sourceCategory).map(toItem) : [] };
    setSections(old => [...old, section]); setHeading(''); setSourceCategory('');
    if (!all) openPicker(section.id, sourceCategory);
  };
  const choices = products.filter(p => (!category || (p.category || 'Uncategorized') === category) && [p.name, p.sku, p.category, p.supplier].some(v => String(v || '').toLowerCase().includes(search.toLowerCase())));
  const resolved = sections.map(section => ({ ...section, name: section.name.trim(), items: section.items.map(item => {
    const product = products.find(p => p.id === item.productId);
    const scheme = item.priceOverride ?? section.priceType ?? master;
    // Keep unavailable products and their saved prices visible rather than silently dropping them.
    return product ? { ...item, sku: product.sku, name: product.name, category: product.category || 'Uncategorized', priceType: scheme, price: productPrice(product, scheme) } : item;
  }) }));
  const items = resolved.flatMap(s => s.items);
  const invalidPromo = resolved.some(s => s.items.some(i => {
    const product = products.find(p => p.id === i.productId);
    return product && i.priceType === 'promo' && product.promoPrice == null;
  }));
  const ready = !!name.trim() && !!items.length && sections.every(s => !!s.name.trim()) && !invalidPromo;
  const build = (): SavedPricelist => ({ ...initial, id: initial?.id || crypto.randomUUID(), name: name.trim(), createdAt: initial?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), defaultScheme: master, sections: resolved, items });
  const persist = async (draft: boolean) => {
    setBusy(true); setError('');
    try { await save(build(), draft); } catch { setError('Could not save this pricelist to the database. Your changes are still open; please try again.'); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent className="max-h-[94vh] w-[96vw] overflow-y-auto sm:!max-w-[96vw] lg:!max-w-[96vw]">
    <DialogHeader><DialogTitle>{initial ? 'Edit Pricelist' : 'Pricelist Builder'}</DialogTitle><DialogDescription>Create headings, add database products, and arrange your pricelist.</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2">Pricelist name<Input value={name} onChange={e => setName(e.target.value)} placeholder="Enter pricelist name" /></label><div className="space-y-2"><p>Master price scheme</p><div className="flex flex-wrap items-center gap-2"><PriceSelect value={master} onChange={v => setMaster(v || 'base')} promo={!!items.length && items.every(i => products.find(p => p.id === i.productId)?.promoPrice != null)} /><MixedPricing sections={resolved} baseline={master} scope="master" /></div><p className="text-xs text-muted-foreground">Sections and items follow this unless overridden.</p><Button variant="outline" onClick={() => setSections(old => old.map(s => ({ ...s, priceType: undefined, items: s.items.map(i => ({ ...i, priceOverride: undefined })) })))}>Apply master to all</Button></div></div>
      {sections.map((section, index) => <section key={section.id} className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2"><Input className="min-w-40 flex-1 font-bold" aria-label={`Section ${index + 1} heading`} value={section.name} onChange={e => patch(section.id, { name: e.target.value })} />
          <Button variant="outline" disabled={index === 0} onClick={() => setSections(old => reorder(old, index, -1))} aria-label={`Move ${section.name} up`}>↑</Button><Button variant="outline" disabled={index === sections.length - 1} onClick={() => setSections(old => reorder(old, index, 1))} aria-label={`Move ${section.name} down`}>↓</Button>
          <Button variant="outline" onClick={() => { if (!section.items.length || window.confirm(`Remove section "${section.name}" and its items from this pricelist?`)) { setSections(old => old.filter(s => s.id !== section.id)); if (activeId === section.id) setActiveId(''); } }}>Remove section</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3"><PriceSelect value={section.priceType} inherit="Follow pricelist" promo={!!section.items.length && section.items.every(i => products.find(p => p.id === i.productId)?.promoPrice != null)} onChange={priceType => patch(section.id, { priceType })} /><MixedPricing sections={[resolved[index]]} baseline={section.priceType ?? master} scope="section" /><Button onClick={() => openPicker(section.id)}>+ Add products</Button><span className="text-sm text-muted-foreground">{section.items.length} items</span></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Product</th><th>Warehouse stock</th><th>Price scheme</th><th>Price</th><th>Arrange</th></tr></thead><tbody>
          {section.items.map((item, itemIndex) => <tr key={`${item.productId}-${itemIndex}`} className="border-b"><td className="p-2"><p>{resolved[index].items[itemIndex].name}</p><p className="text-xs text-muted-foreground">{item.sku}{!products.some(p => p.id === item.productId) && ' · Unavailable in catalog; saved price retained'}</p></td><td>{stockMap[item.productId] ?? 0}</td><td><PriceSelect value={item.priceOverride} inherit="Follow section" promo={products.find(p => p.id === item.productId)?.promoPrice != null} onChange={priceOverride => patch(section.id, { items: section.items.map((i, n) => n === itemIndex ? { ...i, priceOverride } : i) })} /></td><td className="whitespace-nowrap">₱{resolved[index].items[itemIndex].price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td><div className="flex items-center gap-1 p-2">
            <Button variant="ghost" disabled={itemIndex === 0} aria-label={`Move ${item.name} up`} onClick={() => patch(section.id, { items: reorder(section.items, itemIndex, -1) })}>↑</Button><Button variant="ghost" disabled={itemIndex === section.items.length - 1} aria-label={`Move ${item.name} down`} onClick={() => patch(section.id, { items: reorder(section.items, itemIndex, 1) })}>↓</Button>
            <select className={selectClass} aria-label={`Move ${item.name} to section`} value="" onChange={e => { const destination = e.target.value; if (destination) setSections(old => old.map(s => s.id === section.id ? { ...s, items: s.items.filter((_, n) => n !== itemIndex) } : s.id === destination ? { ...s, items: [...s.items, item] } : s)); }}><option value="">Move to…</option>{sections.filter(s => s.id !== section.id && !s.items.some(i => i.productId === item.productId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <Button variant="ghost" aria-label={`Remove ${item.name}`} onClick={() => patch(section.id, { items: section.items.filter((_, n) => n !== itemIndex) })}>Remove</Button>
          </div></td></tr>)}
        </tbody></table>{!section.items.length && <p className="p-4 text-sm text-muted-foreground">Add products to this section.</p>}</div>
      </section>)}
      <div className="space-y-3 rounded-xl border border-dashed p-4"><h3 className="font-semibold">+ Section</h3><div className="flex flex-wrap gap-2"><select aria-label="Use existing category as heading" className={selectClass} value={sourceCategory} onChange={e => { setSourceCategory(e.target.value); setHeading(e.target.value); }}><option value="">Custom heading</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select><Input className="min-w-40 flex-1" aria-label="New section heading" placeholder="Type a section heading" value={heading} onChange={e => setHeading(e.target.value)} /><Button disabled={!heading.trim()} onClick={() => addSection()}>Add section & choose products</Button>{sourceCategory && <Button variant="outline" disabled={!heading.trim()} onClick={() => addSection(true)}>Add section with all category products</Button>}</div></div>
      {invalidPromo && <p role="alert" className="text-destructive">Some products do not have a promo price. Choose another price scheme for those items or their section.</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button variant="outline" disabled={!ready} onClick={() => persist(true)}>Save Draft</Button><Button disabled={!ready} onClick={() => persist(false)}>{busy ? 'Saving…' : 'Save Pricelist'}</Button><Button variant="outline" disabled={!ready} onClick={() => preview(build())}>Preview PDF</Button></DialogFooter>
    </fieldset>
    <Dialog open={!!active} onOpenChange={open => { if (!open) setActiveId(''); }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Add products to {active?.name}</DialogTitle><DialogDescription>Search the catalog and choose products for this section.</DialogDescription></DialogHeader><Input aria-label="Search products" placeholder="Search name, SKU, or supplier" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Filter products by category" className={selectClass} value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
      <Button variant="outline" onClick={() => setSelected(old => [...new Set([...old, ...choices.filter(p => !active?.items.some(i => i.productId === p.id)).map(p => p.id)])])}>Select all filtered products</Button>
      <div className="max-h-80 overflow-y-auto">{choices.map(p => { const added = active?.items.some(i => i.productId === p.id); return <label key={p.id} className="flex items-center gap-3 border-b p-3"><input type="checkbox" disabled={added} checked={added || selected.includes(p.id)} onChange={e => setSelected(old => e.target.checked ? [...old, p.id] : old.filter(id => id !== p.id))} /><span className="flex-1">{p.name}<small className="block text-muted-foreground">{p.sku} · {p.category}</small></span><span className="text-sm">{stockMap[p.id] ?? 0} in stock{added && ' · Added'}</span></label>; })}{!choices.length && <p className="p-4">No products match these filters.</p>}</div>
      <DialogFooter><Button variant="outline" onClick={() => setActiveId('')}>Cancel</Button><Button disabled={!selected.length} onClick={() => { if (active) patch(active.id, { items: [...active.items, ...selected.filter(id => !active.items.some(i => i.productId === id)).flatMap(id => { const p = products.find(p => p.id === id); return p ? [toItem(p)] : []; })] }); setActiveId(''); }}>Add {selected.length} products</Button></DialogFooter>
    </DialogContent></Dialog>
  </DialogContent></Dialog>;
}
