import { useEffect, useState } from 'react';
import { AlertCircle, ImagePlus, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { attributeError, combinationKey, generateVariants, parseAttributes, variantFields, type VariationDraft, type VariantDraft, type VariantField } from '../lib/productVariations';

function VariantImage({ variant, label, onChange }: { variant: VariantDraft; label: string; onChange: (patch: Partial<VariantDraft>) => void }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!variant.imageFile) { setPreview(''); return; }
    const url = URL.createObjectURL(variant.imageFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [variant.imageFile]);
  const source = preview || variant.photoUrl;
  return <div className="flex items-center gap-2">
    <label className="relative flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted hover:bg-muted/70 focus-within:ring-2 focus-within:ring-ring" title={source ? 'Replace variant image' : 'Add variant image'}>
      {source ? <img src={source} alt={`${label} preview`} className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
      <input type="file" accept="image/*" aria-label={`${label} image`} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast.error('Choose an image file for this variant.'); return; }
        onChange({ imageFile: file });
      }} />
    </label>
    {source && <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label} image`} onClick={() => onChange({ imageFile: undefined, photoUrl: '' })}><X className="h-4 w-4" /></Button>}
  </div>;
}

export function ProductVariationEditor({ value, onChange, sku, locked = false }: {
  value: VariationDraft; onChange: (value: VariationDraft) => void; sku: string; locked?: boolean;
}) {
  const [bulk, setBulk] = useState<Partial<Record<VariantField, string>>>({});
  const [applied, setApplied] = useState('');
  const attributes = parseAttributes(value);
  const error = attributeError(attributes);
  const currentKeys = new Set(error ? [] : generateVariants(attributes, [], sku).map(v => combinationKey(v.values)));
  const updateAttributes = (next: VariationDraft['attributes']) => {
    const draft = { ...value, attributes: next };
    const parsed = parseAttributes(draft);
    onChange({ ...draft, variants: attributeError(parsed) ? value.variants : generateVariants(parsed, value.variants, sku) });
  };
  const bulkValid = variantFields.every(([key]) => bulk[key] == null || bulk[key] === '' || (Number.isFinite(Number(bulk[key])) && Number(bulk[key]) >= 0 && (!['minStockLevel', 'reorderPoint'].includes(key) || Number.isInteger(Number(bulk[key])))));
  return <section className="min-w-0 space-y-4 rounded-xl border-2 border-blue-500/80 bg-blue-500/5 p-4 dark:border-blue-400 dark:bg-blue-950/10 transition-colors">
    <label className={`flex items-center justify-between gap-4 ${locked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}>
      <span><span className="block text-sm font-bold text-foreground">Has Variations</span><span className="block text-xs text-muted-foreground">Different options, each with its own SKU, pricing and warehouse stock.</span></span>
      <span className="relative inline-flex shrink-0"><input type="checkbox" role="switch" aria-label="Has Variations" checked={value.enabled} disabled={locked} onChange={e => onChange({ ...value, enabled: e.target.checked })} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" /><span aria-hidden="true" className="h-6 w-11 rounded-full bg-input transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:opacity-50" /><span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" /></span>
    </label>
    {locked && (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300 font-medium">
        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <span><b>Mode Locked:</b> Existing stock was detected on this product. Clear all warehouse stock to 0 via <b>Adjust Stock</b> before changing between a single product and variations.</span>
      </div>
    )}
    {value.enabled && <>
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">Variation attributes <span className="text-muted-foreground">{value.attributes.length}/3</span></h4><Button type="button" size="sm" variant="outline" disabled={value.attributes.length >= 3} onClick={() => updateAttributes([...value.attributes, { name: '', values: '' }])}><Plus className="mr-1 h-4 w-4" />Add attribute</Button></div>
        <p className="text-xs text-muted-foreground">Name an attribute and separate its values with commas. Combinations appear automatically.</p>
        {value.attributes.map((attribute, index) => <div key={index} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[minmax(120px,1fr)_3fr_auto]">
          <label className="col-start-1 row-start-1 min-w-0 text-xs font-medium">Attribute {index + 1}<Input className="mt-1" aria-label={`Attribute ${index + 1} name`} placeholder="e.g. Color, Size, Material" value={attribute.name} onChange={e => updateAttributes(value.attributes.map((a, i) => i === index ? { ...a, name: e.target.value } : a))} /></label>
          <label className="col-start-1 row-start-2 min-w-0 text-xs font-medium sm:col-start-2 sm:row-start-1">Values<Input className="mt-1" aria-label={`Attribute ${index + 1} values`} placeholder="e.g. Black, Silver, Red" value={attribute.values} onChange={e => updateAttributes(value.attributes.map((a, i) => i === index ? { ...a, values: e.target.value } : a))} /></label>
          <Button type="button" variant="ghost" size="icon" className="col-start-2 row-start-1 sm:col-start-3" aria-label={`Remove attribute ${index + 1}`} disabled={value.attributes.length === 1} onClick={() => updateAttributes(value.attributes.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>
        </div>)}
        {error && <p className="text-xs text-amber-700" role="status">{error}</p>}
      </div>
      {!!value.variants.length && <>
        <div className="space-y-3 rounded-lg bg-muted/50 p-3">
          <div><h4 className="text-sm font-semibold">Bulk Apply</h4><p className="text-xs text-muted-foreground">Fill common values, then apply to enabled variants. Blank fields leave existing values unchanged.</p></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{variantFields.map(([key, label]) => <label key={key} className="text-xs font-medium">{label}<Input className="mt-1 bg-background" aria-label={`Bulk ${label}`} type="number" min="0" step={['minStockLevel', 'reorderPoint'].includes(key) ? '1' : '0.01'} placeholder="Unchanged" value={bulk[key] ?? ''} onChange={e => { setBulk({ ...bulk, [key]: e.target.value }); setApplied(''); }} /></label>)}</div>
          <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" size="sm" disabled={!bulkValid || !Object.values(bulk).some(v => v !== '') || !value.variants.some(v => v.enabled)} onClick={() => { const updates = Object.fromEntries(Object.entries(bulk).filter(([, v]) => v !== '')); onChange({ ...value, variants: value.variants.map(v => v.enabled ? { ...v, ...updates } : v) }); setApplied(`Applied to ${value.variants.filter(v => v.enabled).length} variants. You can edit individual cells below.`); }}>Apply to All Variants</Button><span className="text-xs text-muted-foreground" role="status">{applied}</span></div>
        </div>
        <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">Variants</h4><span className="text-xs text-muted-foreground">{value.variants.filter(v => v.enabled).length} enabled · new variants start at 0 stock</span></div>
        <p className="text-xs text-muted-foreground">Uncheck combinations you do not sell. Disabled variants retain their stock and history. Scroll horizontally to edit all columns.</p>
        <div className="overflow-x-auto rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead className="min-w-28">Image</TableHead><TableHead className="min-w-44">Variant</TableHead><TableHead className="min-w-44">Variant SKU</TableHead>{variantFields.map(([key, label]) => <TableHead key={key} className="min-w-28">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{value.variants.map(variant => {
            const label = Object.values(variant.values).join(' / ');
            const present = currentKeys.has(combinationKey(variant.values));
            return <TableRow key={variant.id} className={!variant.enabled ? 'bg-muted/40 text-muted-foreground' : ''}>
              <TableCell><VariantImage variant={variant} label={label} onChange={patch => onChange({ ...value, variants: value.variants.map(v => v.id === variant.id ? { ...v, ...patch } : v) })} /></TableCell>
              <TableCell><label className="flex items-center gap-2 text-xs font-semibold"><input aria-label={`Enable ${label}`} type="checkbox" checked={variant.enabled} disabled={!present} onChange={e => onChange({ ...value, variants: value.variants.map(v => v.id === variant.id ? { ...v, enabled: e.target.checked } : v) })} />{label}</label>{!present && <span className="text-[10px]">Attribute value removed</span>}</TableCell>
              <TableCell><Input aria-label={`${label} SKU`} value={variant.sku} onChange={e => onChange({ ...value, variants: value.variants.map(v => v.id === variant.id ? { ...v, sku: e.target.value } : v) })} /></TableCell>
              {variantFields.map(([key, title]) => <TableCell key={key}><Input aria-label={`${label} ${title}`} type="number" min="0" step={['minStockLevel', 'reorderPoint'].includes(key) ? '1' : '0.01'} value={variant[key]} placeholder={key === 'promoPrice' ? 'None' : '0'} onChange={e => onChange({ ...value, variants: value.variants.map(v => v.id === variant.id ? { ...v, [key]: e.target.value } : v) })} /></TableCell>)}
            </TableRow>;
          })}</TableBody>
        </Table></div>
      </>}
    </>}
  </section>;
}
