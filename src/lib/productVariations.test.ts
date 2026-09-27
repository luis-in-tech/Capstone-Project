import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributeError, emptyVariations, generateVariants, parseAttributes, stockForProduct, validateVariations, variationDraft } from './productVariations';
import type { Product } from '../types';
const product = (id: string, extra: Partial<Product> = {}): Product => ({ id, sku: id, name: id, category: 'Parts', basePrice: 100, minStockLevel: 2, reorderPoint: 5, createdAt: '', updatedAt: '', ...extra });
const attributes = [{ name: 'Color', values: ['Black', 'Red'] }, { name: 'Size', values: ['S', 'M'] }, { name: 'Material', values: ['Steel', 'Alloy'] }];
test('generates full cartesian combinations with distinct stable identities', () => {
  const variants = generateVariants(attributes, [], 'BIKE');
  assert.equal(variants.length, 8);
  assert.equal(new Set(variants.map(v => v.id)).size, 8);
  const changed = variants.map((v, i) => ({ ...v, basePrice: '123.45', enabled: i !== 0 }));
  assert.deepEqual(generateVariants([...attributes].reverse(), changed, 'BIKE').map(v => [v.id, v.enabled, v.basePrice]).sort(), changed.map(v => [v.id, v.enabled, v.basePrice]).sort());
});
test('removed saved combinations keep their identity, prices and disabled history without persisting typing intermediates', () => {
  const variants = generateVariants([attributes[0]], [], 'BIKE');
  variants[0].persisted = true;
  variants[0].costPrice = '22';
  const next = generateVariants([{ name: 'Color', values: ['Blue'] }], variants, 'BIKE');
  assert.equal(next.length, 2);
  assert.equal(next[1].id, variants[0].id);
  assert.equal(next[1].enabled, false);
  assert.equal(next[1].costPrice, '22');
});
test('attribute parsing deduplicates values; incomplete, duplicate and excessive attributes fail', () => {
  const draft = { ...emptyVariations(), attributes: [{ name: ' Color ', values: ' Black, black, Red, ' }] };
  assert.deepEqual(parseAttributes(draft), [{ name: 'Color', values: ['black', 'Red'] }]);
  assert.ok(attributeError([{ name: '', values: ['x'] }]));
  assert.ok(attributeError([attributes[0], attributes[0]]));
  assert.ok(attributeError([...attributes, { name: 'Speed', values: ['7'] }]));
  assert.ok(attributeError([{ name: 'Size', values: Array.from({ length: 251 }, (_, i) => String(i)) }]));
});
test('variant SKU validation catches ordinary product collisions, sibling duplicates and parent SKU', () => {
  const variants = generateVariants([attributes[0]], [], 'BIKE');
  const draft = { enabled: true, attributes: [{ name: 'Color', values: 'Black, Red' }], variants };
  assert.equal(validateVariations(draft, 'BIKE', []), '');
  assert.ok(validateVariations(draft, 'BIKE', [product('other', { sku: variants[0].sku })]));
  assert.ok(validateVariations({ ...draft, variants: variants.map(v => ({ ...v, sku: 'DUP' })) }, 'BIKE', []));
  assert.ok(validateVariations(draft, variants[0].sku, []));
  assert.ok(validateVariations({ ...draft, variants: variants.map(v => ({ ...v, enabled: false })) }, 'BIKE', []));
  assert.ok(validateVariations({ ...draft, variants: variants.map(v => ({ ...v, minStockLevel: '0.5' })) }, 'BIKE', []));
});
test('editing saved variants preserves IDs and permits their existing SKUs', () => {
  const parent = product('parent', { hasVariations: true, variationAttributes: [attributes[0]] });
  const child = product('child', { parentProductId: parent.id, variantValues: { Color: 'Black' }, wholesalePrice: 25 });
  const draft = variationDraft(parent, [child]);
  assert.equal(draft.variants[0].id, child.id);
  assert.equal(draft.variants[0].mmPrice, '25');
  assert.equal(validateVariations(draft, parent.sku, [parent, child], parent.id), '');
  const renamed = generateVariants([{ name: 'Finish', values: ['Black'] }], draft.variants, parent.sku);
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].id, child.id);
  assert.deepEqual(renamed[0].values, { Finish: 'Black' });
});
test('parent stock aggregates variant warehouse balances including disabled variants without double-counting', () => {
  const products = [product('parent', { hasVariations: true }), product('a', { parentProductId: 'parent' }), product('b', { parentProductId: 'parent', variantEnabled: false }), product('simple')];
  const inventory = [['a', 'w1', 10], ['a', 'w2', -2], ['b', 'w1', 3], ['simple', 'w1', 9]].map(([productId, warehouseId, quantity], i) => ({ id: String(i), productId: String(productId), warehouseId: String(warehouseId), quantity: Number(quantity), lastUpdated: '' }));
  assert.equal(stockForProduct(products, inventory, 'parent'), 13);
  assert.equal(stockForProduct(products, inventory, 'parent', 'w2'), -2);
  assert.equal(stockForProduct(products, inventory, 'a', 'w1'), 10);
  assert.equal(stockForProduct(products, inventory, 'simple'), 9);
});
