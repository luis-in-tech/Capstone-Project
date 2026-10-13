import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyBatchQr, receiptBatchUrl } from './receiptBatches';
import { batchLookupUnavailable, createProductSelection, type SelectionContext } from './productSelection';

const origin = 'https://inventory.example.com';
const qr = '/transfers?batch=batch-123';
const product = { id: 'variant-1', sku: 'SKU-123' };
function fixture() {
  const added: typeof product[] = [], messages: string[] = [], loading: boolean[] = [];
  const context: SelectionContext<typeof product> = { products: [product], active: true, onAdd: p => { added.push(p); } };
  return { context, added, messages, loading, ...createProductSelection(() => context, m => messages.push(m), p => loading.push(p)) };
}
function deferred() {
  let resolve!: (value: { productId: string } | null) => void;
  const promise = new Promise<{ productId: string } | null>(r => { resolve = r; });
  return { promise, resolve };
}

test('classifies generated absolute and relative URLs, preserving encoded IDs', () => {
  for (const id of ['batch-123', 'x&quantity=999#fragment'])
    assert.deepEqual(classifyBatchQr(receiptBatchUrl(id, origin), origin), { kind: 'batch', batchId: id });
  assert.deepEqual(classifyBatchQr(` ${qr} `, origin), { kind: 'batch', batchId: 'batch-123' });
  for (const sku of ['SKU-123', ' transfers-sku ', '123', 'https://example.com/product/123'])
    assert.deepEqual(classifyBatchQr(sku, origin), { kind: 'sku' });
});

test('rejects malformed and untrusted batch links', () => {
  for (const value of ['/transfers', '/transfers?batch=', '/transfers?batch=%20',
    '/transfers?batch=a&batch=b', '/transfers?batch=a&quantity=2', '/transfers?batch=%ZZ',
    '/transfers?batch=a#fragment', '/transfers/?batch=a', '/other?batch=a',
    'https://other.example.com/transfers?batch=a', 'https://user@inventory.example.com/transfers?batch=a',
    '//inventory.example.com/transfers?batch=a', 'https://[/transfers?batch=a',
    'javascript:/transfers?batch=a', 'transfers?batch=a', '/transfers?batch=a b'])
    assert.deepEqual(classifyBatchQr(value, origin), { kind: 'invalid-batch' }, value);
});

test('SKU camera/manual selection stays synchronous, exact and case insensitive', () => {
  for (const scan of [true, false]) {
    const f = fixture();
    assert.equal(f.submit(' sku-123 ', scan, origin), 'selected');
    assert.deepEqual(f.added, [product]);
    assert.equal(f.submit('123', scan, origin), 'rejected');
    assert.equal(f.messages.at(-1), 'No eligible product matches this SKU.');
    assert.deepEqual(f.loading, []);
  }
});

test('batch inputs never fall back to SKU; Enter SKU remains SKU-only', () => {
  const f = fixture();
  f.context.products = [{ id: 'url-sku', sku: qr }];
  assert.equal(f.submit(qr, true, origin), 'rejected');
  assert.equal(f.messages.at(-1), batchLookupUnavailable);
  assert.equal(f.submit('/transfers?batch=', true, origin), 'rejected');
  assert.equal(f.messages.at(-1), 'Invalid batch QR.');
  assert.deepEqual(f.added, []);
  assert.equal(f.submit(qr, false, origin), 'selected');
});

test('pending lookup prevents duplicates and uses current eligible options', async () => {
  const f = fixture(), d = deferred();
  let calls = 0;
  f.context.resolveBatch = async () => { calls++; return d.promise; };
  f.context.getProductId = p => p.id;
  const first = f.submit(qr, true, origin);
  assert.equal(f.submit(qr, true, origin), 'ignored');
  assert.equal(f.submit('SKU-123', true, origin), 'ignored');
  const updated = { ...product, sku: 'UPDATED' };
  f.context.products = [updated];
  d.resolve({ productId: product.id });
  assert.equal(await first, 'selected');
  assert.equal(calls, 1);
  assert.deepEqual(f.added, [updated]);
  assert.deepEqual(f.loading, [true, false]);
});

test('cancel aborts stale requests without interfering with newer requests', async () => {
  const f = fixture(), old = deferred(), next = deferred();
  let signal!: AbortSignal;
  f.context.getProductId = p => p.id;
  f.context.resolveBatch = (_, context) => { signal = context.signal; return old.promise; };
  const first = f.submit(qr, true, origin);
  f.cancel();
  assert.equal(signal.aborted, true);
  f.context.resolveBatch = () => next.promise;
  const second = f.submit(qr, true, origin);
  old.resolve({ productId: product.id });
  assert.equal(await first, 'ignored');
  assert.deepEqual(f.added, []);
  assert.equal(f.loading.at(-1), true);
  next.resolve({ productId: product.id });
  assert.equal(await second, 'selected');
});

test('inactive context and changed resolver discard pending results', async () => {
  for (const change of ['inactive', 'resolver']) {
    const f = fixture(), d = deferred();
    f.context.getProductId = p => p.id;
    f.context.resolveBatch = () => d.promise;
    const result = f.submit(qr, true, origin);
    if (change === 'inactive') f.context.active = false;
    else f.context.resolveBatch = async () => null;
    d.resolve({ productId: product.id });
    assert.equal(await result, 'ignored');
    assert.deepEqual(f.added, []);
  }
});

test('resolver failures allow retries with the same batch', async () => {
  const f = fixture();
  f.context.getProductId = p => p.id;
  f.context.resolveBatch = async () => { throw new Error('private backend details'); };
  assert.equal(await f.submit(qr, true, origin), 'retryable');
  assert.equal(f.messages.at(-1), 'Batch lookup failed. Please try again.');
  f.context.resolveBatch = async () => ({ productId: product.id });
  assert.equal(await f.submit(qr, true, origin), 'selected');
});

test('missing and ambiguous eligible products never select arbitrary options', async () => {
  for (const products of [[], [product, { ...product, sku: 'OTHER' }]]) {
    const f = fixture();
    f.context.products = products;
    f.context.getProductId = p => p.id;
    f.context.resolveBatch = async () => ({ productId: product.id });
    assert.equal(await f.submit(qr, true, origin), 'rejected');
    assert.deepEqual(f.added, []);
    assert.match(f.messages.at(-1)!, products.length ? /Multiple items/ : /No eligible product/);
  }
  const f = fixture();
  f.context.getProductId = p => p.id;
  f.context.resolveBatch = async () => null;
  assert.equal(await f.submit(qr, true, origin), 'rejected');
  assert.equal(f.messages.at(-1), 'Batch not found or unavailable.');
});

test('explicit identity accessor is required and caller validation is retained', async () => {
  const f = fixture();
  f.context.resolveBatch = async () => ({ productId: product.id });
  assert.equal(f.submit(qr, true, origin), 'rejected');
  assert.equal(f.messages.at(-1), batchLookupUnavailable);
  f.context.getProductId = p => p.id;
  f.context.onAdd = () => 'This product is out of stock.';
  assert.equal(await f.submit(qr, true, origin), 'rejected');
  assert.equal(f.messages.at(-1), 'This product is out of stock.');
});
