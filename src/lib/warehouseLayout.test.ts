import assert from 'node:assert/strict';
import { test } from 'node:test';
import { warehouseQuantity, zoneQuantity, type ZoneAllocation } from './warehouseLayout';

const inventory = [
  { id: 'i1', warehouseId: 'w1', productId: 'p1', quantity: 60, lastUpdated: '' },
  { id: 'i2', warehouseId: 'w1', productId: 'p1', quantity: 40, lastUpdated: '' },
  { id: 'i3', warehouseId: 'w2', productId: 'p1', quantity: 200, lastUpdated: '' },
];
const allocations: ZoneAllocation[] = [
  { id: 'a1', warehouseId: 'w1', productId: 'p1', zoneId: 'z1', quantity: 30 },
  { id: 'a2', warehouseId: 'w1', productId: 'p1', zoneId: 'z2', quantity: 50 },
  { id: 'a3', warehouseId: 'w2', productId: 'p1', zoneId: 'z3', quantity: 150 },
];

test('split SKU allocations plus Unassigned reconcile with all existing warehouse rows', () => {
  assert.equal(warehouseQuantity(inventory, 'w1', 'p1'), 100);
  assert.equal(zoneQuantity(allocations, inventory, 'w1', 'p1', 'z1'), 30);
  assert.equal(zoneQuantity(allocations, inventory, 'w1', 'p1', 'z2'), 50);
  assert.equal(zoneQuantity(allocations, inventory, 'w1', 'p1', 'unassigned'), 20);
  assert.equal(zoneQuantity(allocations, inventory, 'w2', 'p1', 'unassigned'), 50);
  assert.equal(zoneQuantity(allocations, inventory, 'w1', 'p1', 'z3'), 0);
});

test('existing stock starts Unassigned, and deleting an allocation releases its quantity', () => {
  assert.equal(zoneQuantity([], inventory, 'w1', 'p1', 'unassigned'), 100);
  assert.equal(zoneQuantity(allocations.filter(a => a.zoneId !== 'z1'), inventory, 'w1', 'p1', 'unassigned'), 50);
  assert.equal(warehouseQuantity(inventory, 'w1', 'p1'), 100);
});

test('receipts without a zone increase Unassigned without changing other allocations', () => {
  const received = inventory.map(row => row.id === 'i1' ? { ...row, quantity: row.quantity + 25 } : row);
  assert.equal(zoneQuantity(allocations, received, 'w1', 'p1', 'unassigned'), 45);
  assert.equal(zoneQuantity(allocations, received, 'w1', 'p1', 'z1'), 30);
});

test('missing products have zero stock and quantities never leak between products', () => {
  assert.equal(zoneQuantity(allocations, inventory, 'w1', 'p2', 'z1'), 0);
  assert.equal(zoneQuantity(allocations, inventory, 'w1', 'p2', 'unassigned'), 0);
});
