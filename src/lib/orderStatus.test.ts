import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previousOrderStatus } from './orderStatus';

test('active orders go back one workflow step without toggling through history', () => {
  assert.equal(previousOrderStatus({ status: 'pending' }), null);
  assert.equal(previousOrderStatus({ status: 'preparing' }), 'pending');
  assert.equal(previousOrderStatus({ status: 'out_for_delivery' }), 'preparing');
  assert.equal(previousOrderStatus({ status: 'delivered' }), 'out_for_delivery');
  assert.equal(previousOrderStatus({ status: 'completed' }), 'delivered');
});

test('cancelled and escalated orders restore their last active step', () => {
  const statusHistory = ['pending', 'preparing', 'out_for_delivery', 'cancelled', 'escalated'].map(status => ({
    status: status as import('../types').OrderStatus, changedBy: 'user', timestamp: '',
  }));
  assert.equal(previousOrderStatus({ status: 'cancelled', statusHistory }), 'out_for_delivery');
  assert.equal(previousOrderStatus({ status: 'escalated', statusHistory }), 'out_for_delivery');
  assert.equal(previousOrderStatus({ status: 'cancelled' }), 'pending');
});
