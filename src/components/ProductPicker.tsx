import type { ReactNode } from 'react';
import { SearchBar } from '@/components/ui/search-bar';

export function ProductPicker({ search, onSearch, placeholder = 'Search product name or SKU…', label = 'Search products by name or SKU', empty, children, footer, toolbar }: {
  search: string; onSearch: (value: string) => void; placeholder?: string; label?: string;
  empty: boolean; children: ReactNode; footer?: ReactNode; toolbar?: ReactNode;
}) {
  return <div className="space-y-3">
    <SearchBar aria-label={label} placeholder={placeholder} value={search} onValueChange={onSearch} />
    {toolbar}
    <div className="max-h-[380px] overflow-y-auto rounded-xl border divide-y">
      {children}
      {empty && <p role="status" className="p-8 text-center text-sm text-muted-foreground">No products match your search or filters.</p>}
      {footer}
    </div>
  </div>;
}

export function ProductPickerRow({ name, sku, detail, leading, action, price, priceLabel, selected = false, asLabel = false }: {
  name: string; sku: string; detail?: ReactNode; leading?: ReactNode; action: ReactNode;
  price?: ReactNode; priceLabel?: string; selected?: boolean; asLabel?: boolean;
}) {
  const Row = asLabel ? 'label' : 'div';
  return <Row className={`flex flex-wrap items-center gap-3 p-3 hover:bg-muted/30 ${selected ? 'bg-primary/5' : ''}`}>
    {leading}
    <div className="min-w-0 flex-1 basis-32">
      <p className="break-words text-sm font-medium">{name}</p>
      <div className="mt-1 text-xs text-muted-foreground"><span className="font-mono break-all">{sku}</span>{detail && <> · {detail}</>}</div>
    </div>
    {price != null && <div className="text-right text-xs text-muted-foreground"><span>{priceLabel}</span><p className="mt-1 text-sm font-semibold text-foreground tabular-nums">{price}</p></div>}
    <div className="flex shrink-0 items-center gap-2">{action}</div>
  </Row>;
}
