export function matchProductSku<T extends { sku: string }>(products: T[], value: string): { product: T; error?: never } | { product?: never; error: string } {
  const sku = value.trim().toLowerCase();
  const matches = sku ? products.filter(product => product.sku.trim().toLowerCase() === sku) : [];
  if (!matches.length) return { error: 'No eligible product matches this SKU.' };
  if (matches.length > 1) return { error: 'Multiple items match this SKU. Choose the item under Select products.' };
  return { product: matches[0] };
}
