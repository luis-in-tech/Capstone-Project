import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableStock, newMovementDraft, purchaseTotal, validateMovement } from './inventoryMovement';

const line = { productId: 'p1', name: 'Chain', sku: 'CH-01', quantity: 3, unitCost: 0.1 };
const stock = [{ id: 'i1', productId: 'p1', warehouseId: 'w1', quantity: 4, lastUpdated: '' }];
const receipt = () => ({ ...newMovementDraft(), supplierId: 's1', destinationWarehouseId: 'w2', invoiceNumber: 'INV-1', items: [{ ...line }] });

test('receipt total uses cents and does not require existing warehouse stock', () => {
  assert.equal(purchaseTotal([line, { ...line, productId: 'p2', quantity: 1, unitCost: 0.2 }]), 0.5);
  assert.equal(validateMovement(receipt(), []), null);
});
test('receipt requires supplier, invoice, valid quantity and positive cost', () => {
  for (const patch of [{ supplierId: '' }, { invoiceNumber: ' ' }, { destinationWarehouseId: '' }, { items: [] }])
    assert.ok(validateMovement({ ...receipt(), ...patch }, []));
  for (const quantity of [0, -1, 1.5, NaN, Infinity])
    assert.ok(validateMovement({ ...receipt(), items: [{ ...line, quantity }] }, []));
  for (const unitCost of [0, -1, NaN, Infinity, 1.234])
    assert.ok(validateMovement({ ...receipt(), items: [{ ...line, unitCost }] }, []));
});
test('internal transfer requires distinct warehouses and sufficient source stock, but no purchase fields', () => {
  const draft = { ...newMovementDraft(), type: 'internal' as const, sourceWarehouseId: 'w1', destinationWarehouseId: 'w2', items: [{ ...line, unitCost: 0 }] };
  assert.equal(validateMovement(draft, stock), null);
  assert.ok(validateMovement({ ...draft, destinationWarehouseId: 'w1' }, stock));
  assert.ok(validateMovement({ ...draft, sourceWarehouseId: '' }, stock));
  assert.ok(validateMovement({ ...draft, items: [{ ...line, quantity: 5 }] }, stock));
  assert.ok(validateMovement({ ...draft, items: [line, line] }, stock));
});
test('stock sums matching rows without counting other warehouses', () => {
  assert.equal(availableStock([...stock, { ...stock[0], id: 'i2', quantity: 2 }, { ...stock[0], id: 'i3', warehouseId: 'w2', quantity: 100 }], 'p1', 'w1'), 6);
});
