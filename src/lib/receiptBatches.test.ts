import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receiptBatchUrl, receiptDateToday } from './receiptBatches';

test('receipt QR opens the protected movement page with only a permanent ID', () => {
  const url = new URL(receiptBatchUrl('batch-123', 'https://inventory.example.com'));
  assert.equal(url.pathname, '/transfers');
  assert.deepEqual([...url.searchParams], [['batch', 'batch-123']]);
  assert.equal(url.origin, 'https://inventory.example.com');
});

test('batch IDs cannot add parameters or change the QR destination', () => {
  const id = 'x&quantity=999#fragment';
  const url = new URL(receiptBatchUrl(id, 'https://inventory.example.com'));
  assert.equal(url.searchParams.get('batch'), id);
  assert.equal(url.searchParams.size, 1);
  assert.equal(url.hash, '');
});

test('received date follows the Philippines date even across UTC midnight', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-02T16:30:00Z') });
  assert.equal(receiptDateToday(), '2026-09-03');
});
