import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQueryCacheKey } from './queryKey';

test('buildQueryCacheKey generates stable keys for identical queries and distinct keys for different filters/limits', () => {
  const keyA = buildQueryCacheKey({
    path: 'orders',
    ops: [
      { type: 'orderBy', field: 'createdAt', dir: 'desc' },
      { type: 'limit', n: 20 },
    ],
  });
  const keyB = buildQueryCacheKey({
    path: 'orders',
    ops: [
      { type: 'orderBy', field: 'createdAt', dir: 'desc' },
      { type: 'limit', n: 20 },
    ],
  });
  const keyC = buildQueryCacheKey({
    path: 'orders',
    ops: [{ type: 'orderBy', field: 'createdAt', dir: 'desc' }],
  });
  const keySub = buildQueryCacheKey({
    path: 'order_items',
    isSubcollection: true,
    parentField: 'orderId',
    parentId: 'ord-1',
  });

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyC);
  assert.notEqual(keyC, keySub);
});

