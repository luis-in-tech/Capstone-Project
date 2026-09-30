import { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { collection, db, onSnapshot, query, where } from '../lib/supabaseAdapter';
import type { InventoryMovementRecord } from '../lib/inventoryMovement';
import type { Product } from '../types';
import { ReceiptBatchLabels } from './ReceiptBatchLabels';

export function InventoryBatchTraceability({ product, variants, canView }: {
  product: Product;
  variants: Product[];
  canView: boolean;
}) {
  const selectId = useId();
  const [receipts, setReceipts] = useState<InventoryMovementRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    setError(false);
    return onSnapshot(query(collection(db, 'inventory_movements'), where('type', '==', 'external')), snapshot => {
      setReceipts(snapshot.docs.map((doc: { data: () => InventoryMovementRecord }) => doc.data()));
      setLoading(false);
    }, () => { setError(true); setLoading(false); });
  }, [canView, reload]);

  const productIds = new Set([product.id, ...variants.map(variant => variant.id)]);
  const batches = receipts.flatMap(movement => movement.items
    .filter(item => productIds.has(item.productId) && item.batchId && item.batchCode)
    .map(item => ({ movement, item })))
    .sort((a, b) => (b.item.receivedDate || b.movement.createdAt).localeCompare(a.item.receivedDate || a.movement.createdAt)
      || b.movement.createdAt.localeCompare(a.movement.createdAt));
  const selected = batches.find(batch => batch.item.batchId === selectedId) || batches[0];

  if (!canView) return <p className="mt-4 text-sm text-muted-foreground">Supplier receipt access is required to view CI Traceability labels.</p>;
  if (loading) return <p role="status" className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading received batches...</p>;
  if (error) return <div className="mt-4 space-y-3"><p role="alert" className="text-sm text-muted-foreground">Received batches could not be loaded.</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry</Button></div>;
  if (!selected) return <p className="mt-4 rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">No CI Traceability labels are available for this {product.hasVariations ? 'product or its variants' : 'product'} yet. Labels appear here when a supplier receipt includes a CI Traceability Code.</p>;

  return <div className="mt-4 min-w-0 space-y-4">
    {batches.length > 1 && <div className="space-y-2"><label htmlFor={selectId} className="text-xs font-semibold">Received batch ({batches.length})</label><select id={selectId} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={selected.item.batchId} onChange={event => setSelectedId(event.target.value)}>{batches.map(({ item }) => <option key={item.batchId} value={item.batchId}>{item.batchCode} · {item.receivedDate || 'Date not recorded'}{product.hasVariations ? ` · ${item.sku}` : ''}</option>)}</select></div>}
    <div className="rounded-lg border bg-slate-50 p-4 text-slate-900"><p className="text-xs text-slate-500">Received quantity</p><p className="mt-1 text-xl font-semibold">{selected.item.quantity.toLocaleString()} <span className="text-sm font-normal">units</span></p><p className="mt-1 text-xs text-slate-500">{selected.movement.destinationWarehouseName}</p><p className="mt-2 text-xs text-slate-500">Amount received, not remaining stock.</p></div>
    <ReceiptBatchLabels movement={selected.movement} selectedBatch={selected.item.batchId} selectedOnly />
  </div>;
}
