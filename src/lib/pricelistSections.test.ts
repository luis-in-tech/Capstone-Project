import assert from 'node:assert/strict';
import test from 'node:test';
import { PricelistItem, reorder, sectionsFor } from './pricelistSections';

const item: PricelistItem = { productId: '1', sku: 'SKU1', name: 'Brake', category: 'Brakes', priceType: 'metroManila', price: 120 };
test('legacy lists retain category order and individual saved pricing', () => {
  const sections = sectionsFor({ items: [item, { ...item, productId: '2', category: 'Parts' }, { ...item, productId: '3' }] });
  assert.deepEqual(sections.map(s => s.name), ['Brakes', 'Parts']);
  assert.deepEqual(sections[0].items.map(i => i.productId), ['1', '3']);
  assert.equal(sections[0].items[0].priceOverride, 'metroManila');
  assert.equal(item.priceOverride, undefined);
});
test('custom sections preserve duplicate headings, empty sections, placement and order', () => {
  const sections = [{ id: 'a', name: 'Promo', items: [item] }, { id: 'b', name: 'Promo', items: [] }];
  assert.deepEqual(sectionsFor(JSON.parse(JSON.stringify({ items: [item], sections }))), sections);
  assert.equal(sections[0].items[0].category, 'Brakes');
});
test('reordering preserves entries and does not mutate the source', () => {
  const original = ['a', 'b', 'c'];
  assert.deepEqual(reorder(original, 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(reorder(original, 0, -1), original);
  assert.deepEqual(reorder(original, 2, 1), original);
  assert.deepEqual(original, ['a', 'b', 'c']);
});
