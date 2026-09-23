import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronLeft, CreditCard, Package, Banknote, FileCheck, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { InventoryItem, Product, Warehouse } from '../types';
import { itemDirection, projectBalance, type ChainLine, type ChainTransaction, type SupplyView } from '../lib/supplyChain';

export const chainMoney = (amount: number | null) => amount === null ? 'Not available' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
const selectClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

interface Props {
  view: SupplyView;
  action: 'payment' | 'refund';
  transaction: ChainTransaction;
  products: Product[];
  warehouses: Warehouse[];
  inventory: InventoryItem[];
  onClose: () => void;
  onPreview: (entry: ChainTransaction) => void;
}

export function SupplyChainTransactionDialog({ view, action, transaction, products, warehouses, inventory, onClose, onPreview }: Props) {
  const [method, setMethod] = useState('Cash');
  const [withItems, setWithItems] = useState(true);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [reference, setReference] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [itemSearch, setItemSearch] = useState('');
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const payment = action === 'payment';
  const customer = view === 'customers';
  const physical = payment ? method === 'Item' : withItems;
  const direction = itemDirection(view);
  const increasing = direction === 'in';
  const account = customer ? 'receivables' : 'payables';
  const options: ChainLine[] = payment ? products.map(p => ({ id: p.id, productId: p.id, name: p.name, sku: p.sku, quantity: 0, unitPrice: Number(p.costPrice ?? 0) })) : transaction.items;
  const lines = physical ? options.filter(item => (quantities[item.id] ?? 0) > 0).map(item => ({ ...item, quantity: quantities[item.id], warehouseId })) : [];
  const value = Number(amount);
  const resulting = projectBalance(transaction.remaining, value);
  const cashRefund = !payment && transaction.remaining !== null ? Math.max(0, value - transaction.remaining) : 0;
  const methodLabel = method === 'Item' && !customer ? 'Item / XDeal' : method;
  const title = payment ? customer ? 'Receive payment' : 'Pay supplier' : customer ? 'Customer refund' : 'Purchase refund';

  const validate = () => {
    if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) return 'Enter an amount greater than zero with at most two decimal places.';
    if (payment && transaction.remaining !== null && value > transaction.remaining) return 'Payment cannot exceed the remaining balance.';
    if (!payment && value > (transaction.amount ?? 0)) return 'Refund cannot exceed the original transaction amount.';
    if (payment && method === 'Cheque' && (!bank.trim() || !chequeDate || !reference.trim())) return 'Complete the bank, cheque date, and reference number.';
    if (physical && !warehouses.some(w => w.id === warehouseId && w.active !== false)) return 'Choose an active warehouse.';
    if (physical && !lines.length) return 'Select at least one item and enter a quantity.';
    for (const line of lines) {
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) return 'Use positive whole-number quantities.';
      const original = options.find(item => item.id === line.id)!;
      if (!payment && line.quantity > original.quantity) return `Return quantity for ${line.name} exceeds the original quantity.`;
    }
    if (physical && !increasing) {
      for (const productId of new Set(lines.map(line => line.productId))) {
        const required = lines.filter(line => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0);
        const available = inventory.filter(item => item.productId === productId && item.warehouseId === warehouseId).reduce((sum, item) => sum + item.quantity, 0);
        if (required > available) return `Insufficient stock for ${products.find(p => p.id === productId)?.name || 'selected item'} in this warehouse.`;
      }
    }
    return '';
  };

  function submit() {
    const issue = validate();
    if (issue) { setError(issue); setReview(false); return; }
    if (!review) { setError(''); setReview(true); return; }
    onPreview({
      id: crypto.randomUUID(), entityId: transaction.entityId, parentId: transaction.id,
      type: payment ? customer ? 'Payment' : 'Bill Payment' : customer ? 'Refund' : 'Purchase Refund',
      date: new Date().toISOString(), reference: transaction.reference, amount: value, remaining: resulting,
      status: 'Preview', items: lines, direction: physical ? direction : undefined, draft: true,
      notes: `${payment ? methodLabel : withItems ? 'With Item' : 'Without Item'}${method === 'Cheque' && payment ? ` · ${bank} · ${chequeDate} · ${reference}` : ''}. ${physical ? `Inventory would ${increasing ? 'increase' : 'decrease'} at ${warehouses.find(w => w.id === warehouseId)?.name}.` : 'No inventory movement.'}${cashRefund > 0 ? ` ${chainMoney(cashRefund)} cash refund ${customer ? 'to customer' : 'from supplier'}.` : ''}`,
    });
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><CreditCard className="size-5 text-primary" />{review ? 'Review transaction' : title}</DialogTitle>
        <DialogDescription>{transaction.reference} · {payment ? 'Settle' : 'Credit'} {customer ? 'customer receivables' : 'supplier payables'}</DialogDescription>
      </DialogHeader>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"><Info className="mr-1 inline size-4" />Preview only. This workflow is not connected to a payment/refund ledger. No money or inventory will be posted. Previews clear when you leave Supply Chain.</div>
      {!review ? <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4"><div><p className="text-xs text-muted-foreground">Original amount</p><p className="font-semibold">{chainMoney(transaction.amount)}</p></div><div><p className="text-xs text-muted-foreground">Remaining balance</p><p className="font-semibold">{chainMoney(transaction.remaining)}</p></div></div>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">{payment ? 'Payment method' : 'Return type'}</legend><div className={`grid gap-2 ${payment ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {(payment ? ['Cash', 'Cheque', 'Item'] : ['With Item', 'Without Item']).map((option, i) => {
            const active = payment ? method === option : withItems === (i === 0);
            const Icon = payment ? [Banknote, FileCheck, Package][i] : Package;
            return <button key={option} type="button" aria-pressed={active} onClick={() => { if (payment) setMethod(option); else setWithItems(i === 0); setError(''); }} className={`flex items-center justify-center gap-2 rounded-xl border px-2 py-3 text-sm font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary' : 'hover:bg-muted'}`}><Icon className="size-4" />{option === 'Item' && !customer ? 'Item / XDeal' : option}</button>;
          })}
        </div></fieldset>
        {payment && method === 'Cheque' && <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"><Field label="Bank" id="chain-bank"><Input id="chain-bank" value={bank} onChange={e => setBank(e.target.value)} placeholder="Bank name" /></Field><Field label="Cheque date" id="chain-cheque-date"><Input id="chain-cheque-date" type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)} /></Field><div className="sm:col-span-2"><Field label="Cheque / reference number" id="chain-cheque-ref"><Input id="chain-cheque-ref" value={reference} onChange={e => setReference(e.target.value)} placeholder="Enter reference number" /></Field></div></div>}
        {physical && <div className="space-y-3">
          <div className={`rounded-xl border p-3 text-sm ${increasing ? 'border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-orange-300 bg-orange-500/10 text-orange-700 dark:text-orange-300'}`}>{increasing ? <ArrowDownLeft className="mr-1 inline size-4" /> : <ArrowUpRight className="mr-1 inline size-4" />}Inventory will {increasing ? 'increase' : 'decrease'} · {payment ? customer ? 'Items received from customer' : 'Items issued to supplier' : customer ? 'Customer returns to warehouse' : 'Warehouse returns to supplier'}</div>
          <Field label={increasing ? 'Receiving warehouse' : 'Issuing warehouse'} id="chain-action-warehouse"><select id="chain-action-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={selectClass}><option value="">Select warehouse</option>{warehouses.filter(w => w.active !== false).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Input aria-label="Search transaction items" placeholder={payment ? 'Search inventory items…' : 'Search items from the original transaction…'} value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
          <div className="max-h-48 overflow-y-auto rounded-xl border divide-y">{options.filter(item => `${item.name} ${item.sku}`.toLowerCase().includes(itemSearch.toLowerCase())).map(item => <div key={item.id} className="flex items-center gap-3 p-3"><input type="checkbox" aria-label={`Select ${item.name}`} checked={(quantities[item.id] ?? 0) > 0} onChange={e => setQuantities(q => ({ ...q, [item.id]: e.target.checked ? 1 : 0 }))} className="size-4 accent-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.sku}{!payment && ` · Original qty: ${item.quantity}`}</p></div><Input type="number" aria-label={`Quantity for ${item.name}`} min="0" step="1" max={payment ? undefined : item.quantity} value={quantities[item.id] || ''} placeholder="Qty" onChange={e => setQuantities(q => ({ ...q, [item.id]: Number(e.target.value) }))} className="w-20" /></div>)}{!options.length && <p className="p-6 text-center text-sm text-muted-foreground">No original items are available. Use Without Item for a financial-only refund.</p>}</div>
        </div>}
        <Field label={physical && payment ? 'Manual item valuation (PHP)' : `${payment ? 'Payment' : 'Refund'} amount (PHP)`} id="chain-action-amount"><Input id="chain-action-amount" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="h-12 text-lg font-semibold" /></Field>
        <p className="text-xs text-muted-foreground">{physical && payment ? 'Use the agreed item value to reduce the open balance.' : !physical ? 'This transaction does not move warehouse inventory.' : 'The refund credits the original transaction; selected items move separately.'}</p>
      </div> : <div className="space-y-4"><div className="rounded-xl bg-muted/40 p-5"><p className="text-xs uppercase tracking-wide text-muted-foreground">{title} · {payment ? methodLabel : withItems ? 'With Item' : 'Without Item'}</p><p className="mt-2 text-3xl font-bold">{chainMoney(value)}</p><div className="mt-4 flex justify-between gap-3 border-t pt-4 text-sm"><span>Projected remaining {account}</span><strong>{chainMoney(resulting)}</strong></div>{transaction.remaining === null && <p className="mt-2 text-xs text-muted-foreground">The source record does not provide an exact open balance.</p>}{cashRefund > 0 && <p className="mt-2 text-sm">Cash refund {customer ? 'to customer' : 'from supplier'}: <strong>{chainMoney(cashRefund)}</strong></p>}</div><div className="rounded-xl border p-4"><p className="text-sm font-semibold">{physical ? `Inventory ${increasing ? 'increases' : 'decreases'} at ${warehouses.find(w => w.id === warehouseId)?.name}` : 'No inventory movement'}</p>{lines.map(line => <p key={line.id} className="mt-2 flex justify-between gap-3 text-sm text-muted-foreground"><span>{line.name}</span><strong>{increasing ? '+' : '−'}{line.quantity}</strong></p>)}</div></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" onClick={() => review ? setReview(false) : onClose()}>{review ? <><ChevronLeft className="size-4" />Back</> : 'Cancel'}</Button><Button onClick={submit}>{review ? <><Check className="size-4" />Add to preview</> : 'Review effects'}</Button></div>
    </DialogContent>
  </Dialog>;
}

export function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
