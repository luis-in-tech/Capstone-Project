import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignLocalQuantity, localLayoutKey, readLocalLayout, validLocalAllocations, type LocalLayout } from './warehouseLayoutLocal';

const stock = [{ id: 'i1', warehouseId: 'w1', productId: 'p1', quantity: 100, lastUpdated: '' }];
const layout: LocalLayout = { zones: [
  { id: 'z1', warehouseId: 'w1', name: 'Zone 1', sortOrder: 0 },
  { id: 'z2', warehouseId: 'w1', name: 'Zone 2', sortOrder: 1 },
], allocations: [] };

test('temporary assignments preserve stock and reject over-allocation', () => {
  const first = assignLocalQuantity(layout, stock, 'w1', 'z1', 'p1', 30);
  const second = assignLocalQuantity(first, stock, 'w1', 'z2', 'p1', 50);
  assert.equal(second.allocations.reduce((sum, a) => sum + a.quantity, 0), 80);
  assert.throws(() => assignLocalQuantity(second, stock, 'w1', 'z2', 'p1', 71), /Not enough/);
  assert.equal(assignLocalQuantity(second, stock, 'w1', 'z1', 'p1', 0).allocations.length, 1);
  assert.equal(stock[0].quantity, 100);
  assert.equal(layout.allocations.length, 0);
});

test('temporary storage reloads and isolates users, projects and warehouses', () => {
  const key = localLayoutKey('project', 'admin', 'w1');
  assert.notEqual(key, localLayoutKey('project', 'agent', 'w1'));
  assert.notEqual(key, localLayoutKey('project', 'admin', 'w2'));
  assert.notEqual(key, localLayoutKey('another-project', 'admin', 'w1'));
  const storage = { getItem: (input: string) => input === key ? JSON.stringify(layout) : null };
  assert.deepEqual(readLocalLayout(storage, key, 'w1'), layout);
  assert.deepEqual(readLocalLayout(storage, 'missing', 'w1'), { zones: [], allocations: [] });
  assert.deepEqual(readLocalLayout(storage, key, 'w2'), { zones: [], allocations: [] });
});

test('stock changes invalidate conflicting local assignments without guessing a source zone', () => {
  const saved = assignLocalQuantity(layout, stock, 'w1', 'z1', 'p1', 80);
  assert.equal(validLocalAllocations(saved, stock, 'w1').length, 1);
  assert.equal(validLocalAllocations(saved, [{ ...stock[0], quantity: 50 }], 'w1').length, 0);
  assert.equal(saved.allocations[0].quantity, 80);
});

test('invalid quantities and missing zones cannot be assigned', () => {
  for (const quantity of [-1, 0.5, NaN, Infinity]) assert.throws(() => assignLocalQuantity(layout, stock, 'w1', 'z1', 'p1', quantity));
  assert.throws(() => assignLocalQuantity(layout, stock, 'w2', 'z1', 'p1', 1), /Zone no longer exists/);
  assert.throws(() => readLocalLayout({ getItem: () => 'broken' }, 'key', 'w1'));
});
