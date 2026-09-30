import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProductSku } from './productSelection';

test('SKU entry and scanner values require exact matches while ignoring case and surrounding whitespace', () => {
  const product = { id: 'a', sku: 'SKU-123' };
  assert.equal(matchProductSku([product], ' sku-123 ').product, product);
  assert.ok(matchProductSku([product], '123').error);
  assert.ok(matchProductSku([{ sku: '' }], ' ').error);
});

test('returns cannot resolve products outside the original transaction', () => {
  const originalItems = [{ id: 'original', sku: 'SKU-123' }];
  assert.ok(matchProductSku(originalItems, 'SKU-456').error);
});

test('duplicate SKU transaction lines require explicit selection instead of choosing an arbitrary line', () => {
  const result = matchProductSku([{ id: 'a', sku: 'SKU-123' }, { id: 'b', sku: 'sku-123' }], 'SKU-123');
  assert.ok(result.error?.includes('Multiple items'));
  assert.equal(result.product, undefined);
});
