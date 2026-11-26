import type { Order } from '../types';

export type SupplyView = 'customers' | 'suppliers' | 'warehouses';
export interface ChainLine {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number | null;
  warehouseId?: string;
}
export interface ChainTransaction {
  id: string;
  entityId: string;
  type: string;
  date: string;
  reference: string;
  amount: number | null;
  remaining: number | null;
  dueDate?: string;
  status: string;
  items: ChainLine[];
  direction?: 'in' | 'out';
  draft?: boolean;
  parentId?: string;
  notes?: string;
}

export function dateValue(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') return dateValue(value.toDate());
  const date = new Date(value as string | Date);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

// Payment status alone cannot establish a partially paid balance.
export function orderBalance(order: Order & { remainingBalance?: number }): number | null {
  if (order.status === 'cancelled' || order.status === 'escalated' || order.paymentStatus === 'paid') return 0;
  if (order.remainingBalance != null && Number.isFinite(Number(order.remainingBalance))) return Math.max(0, Number(order.remainingBalance));
  if (order.amountPaid != null && Number.isFinite(Number(order.amountPaid)) && Number(order.amountPaid) > 0) {
    return Math.max(0, (Number(order.totalAmount) || 0) - Number(order.amountPaid));
  }
  if (order.paymentStatus === 'partially_paid') return null;
  return Number(order.totalAmount) || 0;
}

export function isOverdue(row: ChainTransaction, now = Date.now()) {
  if (row.status === 'cancelled' || row.status === 'escalated') return false;
  if (row.remaining == null || row.remaining <= 0 || !row.dueDate) return false;
  const rawDue = row.dueDate.trim();
  const dueMs = /^\d{4}-\d{2}-\d{2}$/.test(rawDue)
    ? new Date(`${rawDue}T23:59:59+08:00`).getTime()
    : new Date(rawDue).getTime();
  return dueMs < now;
}

export function supportsAction(row: ChainTransaction | undefined, action: 'payment' | 'refund') {
  if (!row || !['Order', 'Purchase'].includes(row.type) || row.status === 'cancelled' || row.status === 'escalated' || row.draft) return false;
  return action === 'payment' ? row.remaining === null || row.remaining > 0 : (row.amount ?? 0) > 0;
}

export function itemDirection(view: SupplyView): 'in' | 'out' {
  return view === 'customers' ? 'in' : 'out';
}

export function projectBalance(balance: number | null, amount: number): number | null {
  return balance === null ? null : Math.max(0, Math.round((balance - amount) * 100) / 100);
}
