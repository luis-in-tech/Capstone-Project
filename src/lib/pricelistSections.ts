export type PriceType = 'base' | 'metroManila' | 'provincial' | 'promo';
export interface PricelistItem { productId: string; sku: string; name: string; category: string; priceType: PriceType; price: number; priceOverride?: PriceType; }
export interface PricelistSection { id: string; name: string; priceType?: PriceType; items: PricelistItem[]; }
export interface SavedPricelist { id: string; name: string; createdAt: string; updatedAt?: string; lastPdfGeneratedAt?: string; items: PricelistItem[]; sections?: PricelistSection[]; defaultScheme?: PriceType; }

// Legacy lists retain their category headings and saved prices when opened.
export function sectionsFor(list: Pick<SavedPricelist, 'items' | 'sections'>): PricelistSection[] {
  if (list.sections) return list.sections;
  const groups = new Map<string, PricelistSection>();
  for (const item of list.items) {
    const name = item.category || 'General Category';
    if (!groups.has(name)) groups.set(name, { id: `legacy-${groups.size}`, name, items: [] });
    groups.get(name)!.items.push({ ...item, priceOverride: item.priceType });
  }
  return [...groups.values()];
}

export function reorder<T>(items: T[], index: number, direction: number): T[] {
  const next = [...items], destination = index + direction;
  if (index < 0 || index >= items.length || destination < 0 || destination >= items.length) return next;
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}
