import { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import type { InventoryMovementRecord } from '../lib/inventoryMovement';
import { receiptBatchUrl } from '../lib/receiptBatches';

export function ReceiptBatchLabels({ movement, selectedBatch }: { movement: InventoryMovementRecord; selectedBatch?: string | null }) {
  const labels = useRef<HTMLDivElement>(null);
  const batches = movement.items.filter(item => item.batchId && item.batchCode);
  if (movement.type !== 'external') return null;
  if (!batches.length) return <p className="text-sm text-muted-foreground">No receipt batch labels were recorded for this receipt.</p>;

  function print() {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const target = frame.contentDocument!;
    target.open();
    target.write('<!doctype html><html><head><title>Receipt batch labels</title><style>@page{size:70mm 60mm;margin:3mm}body{margin:0;font:12px sans-serif;color:#000;background:#fff}article{break-after:page;text-align:center;box-sizing:border-box}article:last-child{break-after:auto}p{margin:4px 0}svg{width:32mm;height:32mm}h4{margin:4px 0;font-size:13px}</style></head><body></body></html>');
    target.close();
    for (const label of Array.from(labels.current?.children || [])) target.body.appendChild(target.importNode(label, true));
    frame.contentWindow!.addEventListener('afterprint', () => frame.remove(), { once: true });
    setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); }, 150);
  }

  return <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Receipt batch labels</h3><Button variant="outline" onClick={print}>Print labels</Button></div>
    <div ref={labels} className="grid gap-3 sm:grid-cols-2">{batches.map(item => <article key={item.batchId} className={`rounded-lg border p-4 text-center ${selectedBatch === item.batchId ? 'ring-2 ring-primary' : ''}`}>
      <h4 className="font-semibold">{item.name}</h4><p className="font-mono text-xs">{item.batchCode}</p><p className="text-xs">SKU: {item.sku}</p><p className="text-xs">Received: {item.receivedDate}</p>
      <QRCodeSVG className="mx-auto my-2" value={receiptBatchUrl(item.batchId!, window.location.origin)} size={160} marginSize={4} level="M" />
      {item.supplierLot && <p className="text-xs">Supplier lot: {item.supplierLot}</p>}
    </article>)}</div><p className="text-xs text-muted-foreground">Scan to view this receipt. Quantities above are amounts received; remaining stock is tracked by product and warehouse.</p></section>;
}
