import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import type { InventoryMovementRecord } from '../lib/inventoryMovement';
import { receiptBatchUrl } from '../lib/receiptBatches';

export function ReceiptBatchLabels({ movement, selectedBatch, selectedOnly = false }: { movement: InventoryMovementRecord; selectedBatch?: string | null; selectedOnly?: boolean }) {
  const labels = useRef<HTMLDivElement>(null);
  const batches = movement.items.filter(item => item.batchId && item.batchCode && (!selectedOnly || item.batchId === selectedBatch));
  if (movement.type !== 'external') return null;
  if (!batches.length) return <p className="text-sm text-muted-foreground">No CI Traceability labels were recorded for this receipt.</p>;

  function print() {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const target = frame.contentDocument!;
    target.open();
    target.write('<!doctype html><html><head><title>CI Traceability QR</title><style>@page{size:70mm 60mm;margin:3mm}body{margin:0;font:12px sans-serif;color:#000;background:#fff}article{break-after:page;text-align:center;box-sizing:border-box}article:last-child{break-after:auto}p{margin:4px 0}svg{width:32mm;height:32mm}h4{margin:4px 0;font-size:13px}</style></head><body></body></html>');
    target.close();
    for (const label of Array.from(labels.current?.children || [])) target.body.appendChild(target.importNode(label, true));
    frame.contentWindow!.addEventListener('afterprint', () => frame.remove(), { once: true });
    setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); }, 150);
  }

  return <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">CI Traceability QR</h3><Button variant="outline" onClick={print}>{selectedOnly ? 'Print label' : 'Print labels'}</Button></div>
    <div ref={labels} className={`grid gap-3 ${selectedOnly ? '' : 'sm:grid-cols-2'}`}>{batches.map(item => <article key={item.batchId} className={`rounded-lg border border-slate-200 bg-white p-4 text-center text-slate-900 ${selectedBatch === item.batchId ? 'ring-2 ring-primary' : ''}`}>
      <h4 className="font-semibold">{item.name}</h4><p className="mt-3 text-xs text-slate-500">CI Traceability Code</p><p className="break-all font-mono text-sm font-semibold">{item.batchCode}</p><p className="text-xs">SKU: {item.sku}</p><p className="text-xs">Received: {item.receivedDate}</p>
      <QRCodeSVG className="mx-auto my-2" title={`CI Traceability QR for ${item.batchCode}`} value={receiptBatchUrl(item.batchId!, window.location.origin)} size={160} marginSize={4} level="M" />
      {item.supplierLot && <p className="text-xs">Supplier lot: {item.supplierLot}</p>}
    </article>)}</div>{!selectedOnly && <div className="flex flex-col gap-2">{batches.map(item => <Link key={item.batchId} className="break-all text-sm font-medium underline underline-offset-4" to={`/transfers?batch=${encodeURIComponent(item.batchId!)}`}>View CI record: {item.batchCode}</Link>)}</div>}<p className="text-xs text-slate-500">One QR per received batch. Scan to open its CI Traceability Record.</p></section>;
}
