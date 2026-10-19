import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Order } from '../types';
import { dateValue, isOverdue, itemDirection, orderBalance, projectBalance, supportsAction, type ChainTransaction } from './supplyChain';

const order = { totalAmount: 1000, paymentStatus: 'unpaid', status: 'completed' } as Order;
const transaction: ChainTransaction = { id: 'o1', entityId: 'c1', type: 'Order', date: '2026-09-01', reference: 'ORD-1', amount: 1000, remaining: 1000, status: 'completed', items: [] };

test('balances distinguish unpaid, paid, cancelled, and unknown partial payments', () => {
  assert.equal(orderBalance(order), 1000);
  assert.equal(orderBalance({ ...order, paymentStatus: 'paid' }), 0);
  assert.equal(orderBalance({ ...order, status: 'cancelled' }), 0);
  assert.equal(orderBalance({ ...order, paymentStatus: 'partially_paid' }), null);
  assert.equal(orderBalance({ ...order, paymentStatus: 'partially_paid', remainingBalance: 350 }), 350);
});

test('overdue requires an actual due date and a positive known balance', () => {
  const now = new Date('2026-09-19T12:00:00Z').getTime();
  assert.equal(isOverdue(transaction, now), false);
  assert.equal(isOverdue({ ...transaction, dueDate: '2026-09-01' }, now), true);
  assert.equal(isOverdue({ ...transaction, dueDate: '2026-10-01' }, now), false);
  assert.equal(isOverdue({ ...transaction, dueDate: '2026-09-01', remaining: 0 }, now), false);
  assert.equal(isOverdue({ ...transaction, dueDate: '2026-09-01', remaining: null }, now), false);
});

test('only supported original transactions expose settlement actions', () => {
  assert.equal(supportsAction(undefined, 'payment'), false);
  assert.equal(supportsAction(transaction, 'payment'), true);
  assert.equal(supportsAction({ ...transaction, remaining: 0 }, 'payment'), false);
  assert.equal(supportsAction({ ...transaction, remaining: 0 }, 'refund'), true);
  for (const patch of [{ status: 'cancelled' }, { draft: true }, { type: 'Payment' }, { type: 'Transfer In' }, { type: 'Refund' }]) {
    assert.equal(supportsAction({ ...transaction, ...patch }, 'payment'), false);
    assert.equal(supportsAction({ ...transaction, ...patch }, 'refund'), false);
  }
  assert.equal(supportsAction({ ...transaction, type: 'Purchase', remaining: null }, 'payment'), true);
});

test('customer items come in, supplier items go out, credits never invent balances', () => {
  assert.equal(itemDirection('customers'), 'in');
  assert.equal(itemDirection('suppliers'), 'out');
  assert.equal(projectBalance(1000, 250), 750);
  assert.equal(projectBalance(100, 150), 0);
  assert.equal(projectBalance(null, 250), null);
  assert.equal(projectBalance(0.3, 0.1), 0.2);
});

test('dates accept existing timestamp shapes without inventing missing dates', () => {
  assert.equal(dateValue(undefined), '');
  assert.equal(dateValue('invalid'), '');
  assert.equal(dateValue({ toDate: () => new Date('2026-09-01') }), '2026-09-01T00:00:00.000Z');
});
