import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Order } from '../types';
import { allocateBatchesByStrategy, extractBatchesFromMovements, prioritizeOrderQueue, type AvailableBatch } from './fifoQueueEngine';

test('extractBatchesFromMovements handles timestamp objects and keeps fallback batchIds distinct', () => {
  const batches = extractBatchesFromMovements([
    {
      id: 'm1',
      movementNumber: 'MOV-1',
      type: 'external',
      supplierId: 'sup-1',
      sourceWarehouseId: null,
      destinationWarehouseId: 'wh-1',
      invoiceNumber: 'INV-1',
      driverName: 'Driver',
      vehiclePlate: 'ABC-123',
      notes: '',
      supplierName: 'Test Supplier',
      sourceWarehouseName: null,
      destinationWarehouseName: 'WH1',
      totalValue: 860,
      status: 'confirmed',
      recordedBy: 'u1',
      recordedByName: 'Admin',
      createdAt: { toDate: () => new Date('2026-01-01T00:00:00Z') } as unknown as string,
      expenseId: null,
      items: [
        { productId: 'p1', sku: 'S1', name: 'Part 1', quantity: 5, unitCost: 100 },
        { productId: 'p1', sku: 'S1', name: 'Part 1', quantity: 3, unitCost: 120 },
      ],
    },
  ]);

  assert.equal(batches.length, 2);
  assert.notEqual(batches[0].batchId, batches[1].batchId);
  assert.equal(batches[0].receivedDate, '2026-01-01T00:00:00.000Z');
});

test('allocateBatchesByStrategy validates positive demand, orders batches by FIFO/LIFO, and reports unfulfilled shortfall', () => {
  const batches: AvailableBatch[] = [
    { batchId: 'b-old', batchCode: 'LOT-OLD', productId: 'p1', sku: 'S1', name: 'Part 1', warehouseName: 'WH1', receivedDate: '2026-01-01T00:00:00Z', unitCost: 100, quantity: 4 },
    { batchId: 'b-new', batchCode: 'LOT-NEW', productId: 'p1', sku: 'S1', name: 'Part 1', warehouseName: 'WH1', receivedDate: '2026-02-01T00:00:00Z', unitCost: 150, quantity: 5 },
  ];

  const fifo = allocateBatchesByStrategy(batches, 'p1', 6, 'FIFO');
  assert.equal(fifo.allocations[0].batchId, 'b-old');
  assert.equal(fifo.allocations[1].batchId, 'b-new');
  assert.equal(fifo.remainingUnfulfilled, 0);
  assert.equal(fifo.fulfilledQty, 6);

  const lifo = allocateBatchesByStrategy(batches, 'p1', 5, 'LIFO');
  assert.equal(lifo.allocations[0].batchId, 'b-new');

  const shortfall = allocateBatchesByStrategy(batches, 'p1', 12, 'FIFO');
  assert.equal(shortfall.fulfilledQty, 9);
  assert.equal(shortfall.remainingUnfulfilled, 3);
  assert.equal(shortfall.allocations.every(a => a.batchId !== 'LOT-ORIGINAL-P1'), true);

  const invalid = allocateBatchesByStrategy(batches, 'p1', NaN, 'FIFO');
  assert.equal(invalid.fulfilledQty, 0);
  assert.equal(invalid.allocations.length, 0);
});

test('prioritizeOrderQueue sorts FIFO and LIFO across Firestore-like timestamps and Date instances', () => {
  const o1 = { id: 'o1', createdAt: { toDate: () => new Date('2026-01-10T00:00:00Z') } } as unknown as Order;
  const o2 = { id: 'o2', createdAt: new Date('2026-01-05T00:00:00Z') } as unknown as Order;

  assert.deepEqual(prioritizeOrderQueue([o1, o2], 'FIFO').map(o => o.id), ['o2', 'o1']);
  assert.deepEqual(prioritizeOrderQueue([o1, o2], 'LIFO').map(o => o.id), ['o1', 'o2']);
});
