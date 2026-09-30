import { ArrowLeft, ArrowUpRight, Package, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Product } from '../types';
import type { InventoryMovementRecord, MovementLine } from '../lib/inventoryMovement';
import { ReceiptBatchLabels } from './ReceiptBatchLabels';

export function CITraceabilityRecord({ movement, item, product, onBack, onReceipt }: {
  movement: InventoryMovementRecord;
  item: MovementLine;
  product?: Product;
  onBack: () => void;
  onReceipt: () => void;
}) {
  const variant = Object.entries(product?.variantValues || {}).map(([name, value]) => `${name}: ${value}`).join(' · ');
  const details = [
    ['Supplier', movement.supplierName || 'Not recorded'],
    ['Receipt date', item.receivedDate || 'Not recorded'],
    ['Receiving warehouse', movement.destinationWarehouseName || 'Not recorded'],
    ...(movement.destinationZoneName ? [['Receiving location', movement.destinationZoneName]] : []),
    ['Supplier lot', item.supplierLot || 'Not recorded'],
    ['Supplier invoice', movement.invoiceNumber || 'Not recorded'],
    ...(variant ? [['Variant (current catalog)', variant]] : []),
  ];

  return <div className="space-y-6 rounded-2xl bg-slate-50 p-4 text-slate-900 sm:p-6">
    <button onClick={onBack} className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="size-4" />Back to Item Entry</button>
    <header><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Active Pro / CI Traceability</p><h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">CI Traceability Record</h1><p className="mt-2 text-sm text-slate-600">The receiving record for this inventory batch.</p></header>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-[#101d33] p-5 text-white sm:p-6"><p className="text-xs font-medium text-slate-300">CI Traceability Code · Which received batch</p><p className="mt-2 break-all font-mono text-xl font-semibold sm:text-2xl">{item.batchCode}</p></div>
          <div className="p-5 sm:p-6"><div className="flex items-start gap-3"><Package className="mt-1 size-5 shrink-0 text-slate-500" /><div className="min-w-0"><h2 className="break-words text-xl font-semibold">{item.name}</h2><p className="mt-3 text-xs text-slate-500">SKU · Which product or variant</p><p className="mt-1 break-all font-mono font-semibold">{item.sku}</p></div></div>
            <div className="mt-5 rounded-lg bg-slate-50 p-4"><p className="text-xs text-slate-500">Received quantity</p><p className="mt-1 text-2xl font-semibold">{item.quantity.toLocaleString()} <span className="text-sm font-normal text-slate-600">units</span></p><p className="mt-2 text-xs text-slate-500">Quantity recorded on this receipt. Current stock is tracked by product and warehouse.</p></div>
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="font-semibold">Receiving details</h2><dl className="mt-5 grid gap-5 sm:grid-cols-2">{details.map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>)}</dl></section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Source receipt</h2><p className="mt-1 font-mono text-sm">{movement.movementNumber}</p></div><Button variant="outline" onClick={onReceipt}>View receipt<ArrowUpRight className="size-4" /></Button></div><p className="mt-4 flex items-center gap-2 text-sm text-slate-600"><CheckCircle2 className="size-4 shrink-0 text-emerald-600" />Confirmed{movement.recordedByName ? ` by ${movement.recordedByName}` : ''}</p></section>
      </div>
      <aside className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><ReceiptBatchLabels movement={movement} selectedBatch={item.batchId} selectedOnly /></aside>
    </div>
  </div>;
}
