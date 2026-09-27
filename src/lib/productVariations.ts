import type { Product, VariationAttribute, InventoryItem } from '../types';

export const variantFields = [
  ['basePrice', 'Retail'], ['mmPrice', 'MM'], ['provincialPrice', 'Provincial'],
  ['promoPrice', 'Promo'], ['costPrice', 'Cost'], ['minStockLevel', 'Critical Stock'], ['reorderPoint', 'Restock Level'],
] as const;
export type VariantField = typeof variantFields[number][0];
export type VariantDraft = { id: string; values: Record<string, string>; sku: string; enabled: boolean; persisted?: boolean; photoUrl?: string; imageFile?: File } & Record<VariantField, string>;
export interface VariationDraft { enabled: boolean; attributes: { name: string; values: string }[]; variants: VariantDraft[] }
export const emptyVariations = (): VariationDraft => ({ enabled: false, attributes: [{ name: '', values: '' }], variants: [] });
export const variantLabel = (product: Pick<Product, 'variantValues'>) => Object.values(product.variantValues || {}).join(' / ');
export const combinationKey = (values: Record<string, string>) => JSON.stringify(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]).sort(([a], [b]) => a.localeCompare(b)));
export function parseAttributes(draft: VariationDraft): VariationAttribute[] {
  return draft.attributes.map(a => ({ name: a.name.trim(), values: [...new Map(a.values.split(',').map(v => v.trim()).filter(Boolean).map(v => [v.toLowerCase(), v])).values()] }));
}
export function attributeError(attributes: VariationAttribute[]) {
  if (!attributes.length || attributes.length > 3 || attributes.some(a => !a.name || !a.values.length)) return 'Give each attribute a name and at least one value.';
  if (new Set(attributes.map(a => a.name.toLowerCase())).size !== attributes.length) return 'Attribute names must be unique.';
  if (attributes.reduce((n, a) => n * a.values.length, 1) > 250) return 'Use fewer values: a product can have up to 250 combinations.';
  return '';
}
export function generateVariants(attributes: VariationAttribute[], previous: VariantDraft[], sku: string): VariantDraft[] {
  if (attributeError(attributes)) return previous;
  const combinations = attributes.reduce<Record<string, string>[]>((rows, a) => rows.flatMap(row => a.values.map(value => ({ ...row, [a.name]: value }))), [{}]);
  const existing = new Map(previous.map(v => [combinationKey(v.values), v]));
  const valueKey = (values: Record<string, string>) => JSON.stringify(Object.values(values).map(v => v.toLowerCase()));
  const generated = combinations.map((values, i) => {
    // Renaming an attribute must not create a new stock identity for the same values.
    const old = existing.get(combinationKey(values)) || previous.find(v => valueKey(v.values) === valueKey(values));
    if (old) return { ...old, values };
    const suffix = Object.values(values).join('-').replace(/[^a-zA-Z0-9-]/g, '').toUpperCase() || String(i + 1);
    return { id: crypto.randomUUID(), values, sku: sku ? `${sku}-${suffix}` : '', enabled: true, ...Object.fromEntries(variantFields.map(([key]) => [key, key === 'promoPrice' ? '' : '0'])) } as VariantDraft;
  });
  const ids = new Set(generated.map(v => v.id));
  // Retain identities and edits when an attribute/value is removed. Never delete stock history.
  return [...generated, ...previous.filter(v => v.persisted && !ids.has(v.id)).map(v => ({ ...v, enabled: false }))];
}
export function variationDraft(product: Product, children: Product[]): VariationDraft {
  return {
    enabled: !!product.hasVariations,
    attributes: product.variationAttributes?.length ? product.variationAttributes.map(a => ({ name: a.name, values: a.values.join(', ') })) : [{ name: '', values: '' }],
    variants: children.map(p => ({ id: p.id, persisted: true, photoUrl: p.photoUrl, values: p.variantValues || {}, sku: p.sku, enabled: p.variantEnabled !== false,
      ...Object.fromEntries(variantFields.map(([key]) => [key, String(p[key] ?? (key === 'mmPrice' ? p.wholesalePrice ?? 0 : key === 'provincialPrice' ? p.dealerPrice ?? 0 : key === 'promoPrice' ? '' : 0))])) } as VariantDraft)),
  };
}
export function validateVariations(draft: VariationDraft, parentSku: string, products: Product[], parentId?: string): string {
  if (!draft.enabled) return '';
  const error = attributeError(parseAttributes(draft));
  if (error) return error;
  if (!draft.variants.some(v => v.enabled)) return 'Enable at least one variant.';
  const used = new Set(products.filter(p => !parentId || (p.id !== parentId && p.parentProductId !== parentId)).map(p => p.sku.trim().toLowerCase()));
  used.add(parentSku.trim().toLowerCase());
  for (const v of draft.variants) {
    if (!v.sku.trim() || used.has(v.sku.trim().toLowerCase())) return `Variant SKU must be unique: ${v.sku || Object.values(v.values).join(' / ')}.`;
    used.add(v.sku.trim().toLowerCase());
    for (const [key, label] of variantFields) {
      if (key === 'promoPrice' && v[key] === '') continue;
      const value = Number(v[key]);
      if (v[key] === '' || !Number.isFinite(value) || value < 0 || ((key === 'minStockLevel' || key === 'reorderPoint') && !Number.isInteger(value))) return `${label} must be a non-negative ${key === 'minStockLevel' || key === 'reorderPoint' ? 'whole number' : 'number'} for ${v.sku}.`;
    }
  }
  return '';
}
export function stockForProduct(products: Product[], inventory: InventoryItem[], productId: string, warehouseId?: string) {
  const product = products.find(p => p.id === productId);
  const ids = new Set(product?.hasVariations ? products.filter(p => p.parentProductId === productId).map(p => p.id) : [productId]);
  return inventory.filter(i => ids.has(i.productId) && (!warehouseId || warehouseId === 'all' || i.warehouseId === warehouseId))
    .reduce((sum, i) => sum + (warehouseId && warehouseId !== 'all' ? i.quantity : Math.max(0, i.quantity)), 0);
}
