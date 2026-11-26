import { ProductSelectionModes } from './ProductSelectionModes';
import { ProductPicker, ProductPickerRow } from './ProductPicker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { WarningIcon as TriangleAlert } from '@phosphor-icons/react';
import { Product } from '../types';
import { PricelistItem, PricelistSection, PriceType, SavedPricelist, reorder, sectionsFor } from '../lib/pricelistSections';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '../hooks/useAuth';
import { useStaffAccess } from '../hooks/useStaffAccess';
import { hasAdminRole } from '../lib/staffPermissions';
import { ConfirmDialog } from './ConfirmDialog';

const labels: Record<PriceType, string> = { base: 'Regular', metroManila: 'Metro Manila', provincial: 'Provincial', promo: 'Promo' };
const productPrice = (p: Product, type: PriceType) => Number(type === 'metroManila' ? p.mmPrice ?? p.wholesalePrice ?? p.basePrice ?? 0 : type === 'provincial' ? p.provincialPrice ?? p.dealerPrice ?? p.basePrice ?? 0 : type === 'promo' ? p.promoPrice ?? 0 : p.basePrice || 0);
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
    <Tooltip.Portal><Tooltip.Positioner side="bottom" align="start" sideOffset={6} className="z-100">
      <Tooltip.Popup className="max-h-72 w-80 max-w-[90vw] overflow-y-auto rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md">
        <p className="font-semibold">Different from {scope} pricing ({labels[baseline]})</p>
        <ul className="mt-2 space-y-2">{differences.map(({ section, item }, index) => <li key={`${item.productId}-${index}`} className="wrap-break-word">
          {scope === 'master' && <span className="block text-xs text-muted-foreground">{section}</span>}
          <span>{item.name} ({item.sku}) — <b>{labels[item.priceType]}</b></span>
        </li>)}</ul>
      </Tooltip.Popup>
    </Tooltip.Positioner></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

function PriceSelect({ value, onChange, inherit, promo, mainOnly }: { value?: PriceType; onChange: (value?: PriceType) => void; inherit?: string; promo: boolean; mainOnly?: boolean }) {
  const allowedLabels = mainOnly ? { base: 'Regular' } : labels;
  const clampedValue = mainOnly ? (value && value !== 'base' ? (inherit ? '' : 'base') : (value || '')) : (value || '');
  return <select aria-label={inherit ? `Price scheme (${inherit})` : 'Master price scheme'} className={selectClass} value={clampedValue} onChange={e => {
    const next = (e.target.value || undefined) as PriceType | undefined;
    onChange(mainOnly && next && next !== 'base' ? 'base' : next);
  }}>
    {inherit && <option value="">{inherit}</option>}
    {Object.entries(allowedLabels).filter(([key]) => key !== 'promo' || promo || (!mainOnly && value === 'promo')).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
  </select>;
}

const PICKER_PAGE_SIZE = 50;

export const PricelistBuilder = React.memo(function PricelistBuilder({ initial, products, stockMap, close, save, preview }: {
  initial?: SavedPricelist; products: Product[]; stockMap: Record<string, number>; close: () => void;
  save: (list: SavedPricelist, draft: boolean) => Promise<void>; preview: (list: SavedPricelist) => void;
}) {
  const { profile } = useAuth();
  const { permissions } = useStaffAccess();
  const mainOnly = !hasAdminRole(profile ?? null) && permissions.priceAccess === 'main_only';
  const [name, setName] = useState(initial?.name || '');
  const [master, setMaster] = useState<PriceType>(mainOnly ? 'base' : (initial?.defaultScheme || 'base'));
  const effectiveMaster: PriceType = mainOnly ? 'base' : master;
  useEffect(() => {
    if (mainOnly && master !== 'base') setMaster('base');
  }, [mainOnly, master]);
  const [sections, setSections] = useState<PricelistSection[]>(() => initial ? sectionsFor(initial) : []);
  const [heading, setHeading] = useState('');
  const [sourceCategory, setSourceCategory] = useState('');
  const [activeId, setActiveId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [pickerPage, setPickerPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [sectionToRemove, setSectionToRemove] = useState<PricelistSection | null>(null);

  const productById = useMemo(
    () => new Map(products.map(p => [p.id, p])),
    [products],
  );
  const categories = useMemo(
    () => [...new Set(products.map(p => p.category || 'Uncategorized'))].sort(),
    [products],
  );
  const inStockProducts = useMemo(
    () => products.filter(p => (stockMap[p.id] ?? 0) > 0),
    [products, stockMap],
  );

  const active = useMemo(() => sections.find(s => s.id === activeId), [sections, activeId]);
  const isPickerOpen = Boolean(active && !busy);
  const activeItemIdSet = useMemo(
    () => new Set(active?.items.map(i => i.productId) ?? []),
    [active],
  );

  const patch = (id: string, update: Partial<PricelistSection>) => setSections(old => old.map(s => s.id === id ? { ...s, ...update } : s));
  const toItem = useCallback((p: Product): PricelistItem => ({ productId: p.id, sku: p.sku, name: p.name, category: p.category || 'Uncategorized', priceType: effectiveMaster, price: productPrice(p, effectiveMaster) }), [effectiveMaster]);
  const openPicker = (id: string, filter = '') => { setActiveId(id); setCategory(filter); setSearch(''); setPickerPage(1); };
  const addToSection = useCallback((product: Product) => {
    if (!active) return 'Choose a section first.';
    if (activeItemIdSet.has(product.id)) return 'This product is already added to this section.';
    setSections(old => old.map(section => section.id === active.id && !section.items.some(item => item.productId === product.id) ? { ...section, items: [...section.items, toItem(product)] } : section));
  }, [active, activeItemIdSet, toItem]);
  const addSection = (all = false) => {
    if (!heading.trim()) return;
    const section = { id: crypto.randomUUID(), name: heading.trim(), items: all ? products.filter(p => (p.category || 'Uncategorized') === sourceCategory && (includeOutOfStock || (stockMap[p.id] ?? 0) > 0)).map(toItem) : [] };
    setSections(old => [...old, section]); setHeading(''); setSourceCategory('');
    if (!all) openPicker(section.id, sourceCategory);
  };

  const activeProductPool = includeOutOfStock ? products : inStockProducts;
  const choices = useMemo(() => {
    if (!isPickerOpen) return [];
    const q = search.toLowerCase();
    return activeProductPool.filter(p =>
      (!category || (p.category || 'Uncategorized') === category) &&
      (!q || [p.name, p.sku, p.category, p.supplier].some(v => String(v || '').toLowerCase().includes(q))),
    );
  }, [isPickerOpen, activeProductPool, category, search]);
  const totalPickerPages = Math.max(1, Math.ceil(choices.length / PICKER_PAGE_SIZE));
  const safePickerPage = Math.min(pickerPage, totalPickerPages);
  const pickerPageStart = (safePickerPage - 1) * PICKER_PAGE_SIZE;
  const visibleChoices = useMemo(
    () => choices.slice(pickerPageStart, pickerPageStart + PICKER_PAGE_SIZE),
    [choices, pickerPageStart],
  );

  const resolved = useMemo(() => sections.map(section => ({ ...section, name: section.name.trim(), items: section.items.map(item => {
    const product = productById.get(item.productId);
    const scheme: PriceType = mainOnly ? 'base' : (item.priceOverride ?? section.priceType ?? effectiveMaster);
    // Keep unavailable products and their saved prices visible rather than silently dropping them.
    return product ? { ...item, sku: product.sku, name: product.name, category: product.category || 'Uncategorized', priceType: scheme, price: productPrice(product, scheme) } : item;
  }) })), [sections, productById, mainOnly, effectiveMaster]);
  const items = useMemo(() => resolved.flatMap(s => s.items), [resolved]);
  const invalidPromo = useMemo(() => resolved.some(s => s.items.some(i => {
    const product = productById.get(i.productId);
    return product && i.priceType === 'promo' && product.promoPrice == null;
  })), [resolved, productById]);
  const allItemsHavePromo = useMemo(
    () => !!items.length && items.every(i => productById.get(i.productId)?.promoPrice != null),
    [items, productById],
  );
  const ready = !!name.trim() && !!items.length && sections.every(s => !!s.name.trim()) && !invalidPromo;
  const build = (): SavedPricelist => ({ ...initial, id: initial?.id || crypto.randomUUID(), name: name.trim(), createdAt: initial?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), defaultScheme: effectiveMaster, sections: resolved, items });
  const persist = async (draft: boolean) => {
    setBusy(true); setError('');
    try { await save(build(), draft); } catch { setError('Could not save this pricelist to the database. Your changes are still open; please try again.'); } finally { setBusy(false); }
  };
  return <><Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent className="max-h-[94vh] w-[96vw] overflow-y-auto sm:max-w-[96vw]! lg:max-w-[96vw]!">
    <DialogHeader><DialogTitle>{initial ? 'Edit Pricelist' : 'Pricelist Builder'}</DialogTitle><DialogDescription>Create headings, add database products, and arrange your pricelist.</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2">Pricelist name<Input value={name} onChange={e => setName(e.target.value)} placeholder="Enter pricelist name" /></label><div className="space-y-2"><p>Master price scheme</p><div className="flex flex-wrap items-center gap-2"><PriceSelect value={effectiveMaster} onChange={v => setMaster(v || 'base')} promo={allItemsHavePromo} mainOnly={mainOnly} /><MixedPricing sections={resolved} baseline={effectiveMaster} scope="master" /></div><p className="text-xs text-muted-foreground">Sections and items follow this unless overridden.</p><Button variant="outline" onClick={() => setSections(old => old.map(s => ({ ...s, priceType: undefined, items: s.items.map(i => ({ ...i, priceOverride: undefined })) })))}>Apply master to all</Button></div></div>
      {sections.map((section, index) => <section key={section.id} className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2"><Input className="min-w-40 flex-1 font-bold" aria-label={`Section ${index + 1} heading`} value={section.name} onChange={e => patch(section.id, { name: e.target.value })} />
          <Button variant="outline" disabled={index === 0} onClick={() => setSections(old => reorder(old, index, -1))} aria-label={`Move ${section.name} up`}>↑</Button><Button variant="outline" disabled={index === sections.length - 1} onClick={() => setSections(old => reorder(old, index, 1))} aria-label={`Move ${section.name} down`}>↓</Button>
          <Button type="button" variant="outline" onClick={() => { if (!section.items.length) { setSections(old => old.filter(s => s.id !== section.id)); if (activeId === section.id) setActiveId(''); } else { setSectionToRemove(section); } }}>Remove section</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3"><PriceSelect value={mainOnly ? 'base' : section.priceType} inherit="Follow pricelist" promo={!!section.items.length && section.items.every(i => productById.get(i.productId)?.promoPrice != null)} onChange={priceType => patch(section.id, { priceType })} mainOnly={mainOnly} /><MixedPricing sections={[resolved[index]]} baseline={mainOnly ? 'base' : (section.priceType ?? effectiveMaster)} scope="section" /><Button onClick={() => openPicker(section.id)}>+ Add products</Button><span className="text-sm text-muted-foreground">{section.items.length} items</span></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Product</th><th>Warehouse stock</th><th>Price scheme</th><th>Price</th><th>Arrange</th></tr></thead><tbody>
          {section.items.map((item, itemIndex) => {
            const catalogProduct = productById.get(item.productId);
            return <tr key={`${item.productId}-${itemIndex}`} className="border-b"><td className="p-2"><p>{resolved[index].items[itemIndex].name}</p><p className="text-xs text-muted-foreground">{item.sku}{!catalogProduct && ' · Unavailable in catalog; saved price retained'}</p></td><td>{stockMap[item.productId] ?? 0}</td><td><PriceSelect value={item.priceOverride} inherit="Follow section" promo={catalogProduct?.promoPrice != null} onChange={priceOverride => patch(section.id, { items: section.items.map((i, n) => n === itemIndex ? { ...i, priceOverride } : i) })} mainOnly={mainOnly} /></td><td className="whitespace-nowrap">₱{resolved[index].items[itemIndex].price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td><div className="flex items-center gap-1 p-2">
              <Button variant="ghost" disabled={itemIndex === 0} aria-label={`Move ${item.name} up`} onClick={() => patch(section.id, { items: reorder(section.items, itemIndex, -1) })}>↑</Button><Button variant="ghost" disabled={itemIndex === section.items.length - 1} aria-label={`Move ${item.name} down`} onClick={() => patch(section.id, { items: reorder(section.items, itemIndex, 1) })}>↓</Button>
              <select className={selectClass} aria-label={`Move ${item.name} to section`} value="" onChange={e => { const destination = e.target.value; if (destination) setSections(old => old.map(s => s.id === section.id ? { ...s, items: s.items.filter((_, n) => n !== itemIndex) } : s.id === destination ? { ...s, items: [...s.items, item] } : s)); }}><option value="">Move to…</option>{sections.filter(s => s.id !== section.id && !s.items.some(i => i.productId === item.productId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <Button variant="ghost" aria-label={`Remove ${item.name}`} onClick={() => patch(section.id, { items: section.items.filter((_, n) => n !== itemIndex) })}>Remove</Button>
            </div></td></tr>;
          })}
        </tbody></table>{!section.items.length && <p className="p-4 text-sm text-muted-foreground">Add products to this section.</p>}</div>
      </section>)}
      <div className="space-y-3 rounded-xl border border-dashed p-4"><h3 className="font-semibold">+ Section</h3><div className="flex flex-wrap gap-2"><select aria-label="Use existing category as heading" className={selectClass} value={sourceCategory} onChange={e => { setSourceCategory(e.target.value); setHeading(e.target.value); }}><option value="">Custom heading</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select><Input className="min-w-40 flex-1" aria-label="New section heading" placeholder="Type a section heading" value={heading} onChange={e => setHeading(e.target.value)} /><Button disabled={!heading.trim()} onClick={() => addSection()}>Add section & choose products</Button>{sourceCategory && <Button variant="outline" disabled={!heading.trim()} onClick={() => addSection(true)}>Add section with all category products</Button>}</div></div>
      {invalidPromo && <p role="alert" className="text-destructive">Some products do not have a promo price. Choose another price scheme for those items or their section.</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button variant="outline" disabled={!ready} onClick={() => persist(true)}>Save Draft</Button><Button disabled={!ready} onClick={() => persist(false)}>{busy ? 'Saving…' : 'Save Pricelist'}</Button><Button variant="outline" disabled={!ready} onClick={() => preview(build())}>Export / Preview PDF</Button></DialogFooter>
    </fieldset>
  </DialogContent></Dialog>
  <Dialog open={isPickerOpen} onOpenChange={open => { if (!open && !busy) setActiveId(''); }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Add products to {active?.name}</DialogTitle><DialogDescription>Search the catalog and choose products for this section.</DialogDescription></DialogHeader>
      {isPickerOpen && (
        <ProductSelectionModes key={activeId} products={activeProductPool} active={isPickerOpen} onAdd={addToSection} hint="Add a product once to this section. Products already added remain marked Added.">
        <ProductPicker
          search={search}
          onSearch={value => { setSearch(value); setPickerPage(1); }}
          placeholder="Search name, SKU, or supplier"
          label="Search products by name, SKU, or supplier"
          empty={!choices.length}
          toolbar={<div className="flex flex-wrap items-center gap-2">
            <select aria-label="Filter products by category" className={selectClass} value={category} onChange={e => { setCategory(e.target.value); setPickerPage(1); }}><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
            <Button type="button" variant="outline" onClick={() => { if (active) setSections(old => old.map(section => section.id === active.id ? { ...section, items: [...section.items, ...choices.filter(p => !activeItemIdSet.has(p.id)).map(toItem)] } : section)); }}>Add all filtered products</Button>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted/50 transition-colors">
              <input type="checkbox" checked={includeOutOfStock} onChange={e => { setIncludeOutOfStock(e.target.checked); setPickerPage(1); }} className="size-4 rounded accent-primary cursor-pointer" />
              <span>Include out of stock</span>
            </label>
          </div>}
          footer={choices.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <span>
                Showing {pickerPageStart + 1}–{Math.min(pickerPageStart + visibleChoices.length, choices.length)} of {choices.length.toLocaleString()} products
              </span>
              {totalPickerPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={safePickerPage <= 1} onClick={() => setPickerPage(p => Math.max(1, p - 1))}>Previous</Button>
                  <span className="px-1 font-medium text-foreground">Page {safePickerPage} of {totalPickerPages}</span>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={safePickerPage >= totalPickerPages} onClick={() => setPickerPage(p => Math.min(totalPickerPages, p + 1))}>Next</Button>
                </div>
              )}
            </div>
          ) : undefined}
        >
          {visibleChoices.map(p => {
            const added = activeItemIdSet.has(p.id);
            const scheme: PriceType = mainOnly ? 'base' : (active?.priceType ?? effectiveMaster);
            return <ProductPickerRow key={p.id} name={p.name} sku={p.sku} selected={added}
              detail={<>{p.category} · {stockMap[p.id] ?? 0} in stock</>}
              priceLabel={labels[scheme]} price={scheme === 'promo' && p.promoPrice == null ? 'Not available' : `₱${productPrice(p, scheme).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              action={<Button type="button" variant="outline" size="sm" disabled={added} aria-label={`Add ${p.name}`} onClick={() => addToSection(p)}>{added ? 'Added' : '+ Add'}</Button>} />;
          })}
        </ProductPicker>
        </ProductSelectionModes>
      )}
      <DialogFooter><span className="mr-auto text-sm text-muted-foreground">{active?.items.length ?? 0} products in this section</span><Button onClick={() => setActiveId('')}>Done</Button></DialogFooter>
    </DialogContent></Dialog>
  <ConfirmDialog
    open={!!sectionToRemove}
    title="Remove section"
    description={`Remove section "${sectionToRemove?.name ?? ''}" and its items from this pricelist?`}
    confirmLabel="Remove section"
    destructive
    onOpenChange={open => { if (!open) setSectionToRemove(null); }}
    onConfirm={() => {
      if (!sectionToRemove) return;
      setSections(old => old.filter(s => s.id !== sectionToRemove.id));
      if (activeId === sectionToRemove.id) setActiveId('');
      setSectionToRemove(null);
    }}
  /></>;
});
