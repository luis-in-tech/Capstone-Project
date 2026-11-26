import assert from 'node:assert/strict';
import test from 'node:test';
import { preloadRoute, resolveRoutePrefetchKey } from './routePrefetch';

test('resolveRoutePrefetchKey maps direct, nested, and root paths accurately', () => {
  assert.equal(resolveRoutePrefetchKey('/orders'), '/orders');
  assert.equal(resolveRoutePrefetchKey('/orders?orderId=123#top'), '/orders');
  assert.equal(resolveRoutePrefetchKey('/inventory/layout'), '/inventory');
  assert.equal(resolveRoutePrefetchKey('/'), '/auth');
  assert.equal(resolveRoutePrefetchKey('/non-existent-route'), null);
});

test('preloadRoute deduplicates repeated preloads and recovers if a chunk fetch rejects', async () => {
  const seen = new Set<string>();
  let calls = 0;
  const fakeLoaders = {
    '/orders': async () => {
      calls += 1;
    },
  };

  assert.equal(preloadRoute('/orders?orderId=abc', fakeLoaders, seen), true);
  assert.equal(preloadRoute('/orders', fakeLoaders, seen), false);
  assert.equal(calls, 1);

  const failingLoaders = {
    '/orders': async () => {
      calls += 1;
      throw new Error('network error');
    },
  };
  const failSeen = new Set<string>();
  assert.equal(preloadRoute('/orders', failingLoaders, failSeen), true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(failSeen.has('/orders'), false);
});

