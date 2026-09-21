import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existingCustomers,
  groupedOrderTotals,
  type CartLine,
  orderTotals,
  priceLabels,
  productPrices,
  receiptPages,
  type ReceiptOrder,
} from "./orderEntry";
import type { Product } from "../types";

test("order totals use the selected selling prices and one receipt-wide discount", () => {
  const totals = orderTotals(
    [
      { quantity: 3, unitPrice: 0.1 },
      { quantity: 2, unitPrice: 175.25 },
    ],
    25.5,
  );
  assert.deepEqual(totals, {
    subtotal: 350.8,
    discount: 25.5,
    total: 325.3,
    valid: true,
  });
  assert.equal(orderTotals([{ quantity: 1, unitPrice: 100 }], 100).total, 0);
});

test("discount cannot be negative, exceed subtotal, be non-finite, or have fractional cents", () => {
  for (const discount of [-1, 101, NaN, Infinity, 0.001]) {
    assert.equal(
      orderTotals([{ quantity: 1, unitPrice: 100 }], discount).valid,
      false,
    );
  }
});

test("price schemes preserve zero prices, absent promos, and legacy regional fields", () => {
  const product = {
    basePrice: 200,
    mmPrice: 0,
    wholesalePrice: 180,
    dealerPrice: 170,
    costPrice: 50,
  } as Product;
  assert.deepEqual(productPrices(product), {
    regular: 200,
    mm: 0,
    provincial: 170,
    promo: null,
    cost: 50,
  });
  assert.equal("cost" in priceLabels, false);
  assert.equal(productPrices({ ...product, mmPrice: undefined }).mm, 180);
});

test("existing customers deduplicate by name and retain the newest real address", () => {
  const orders = [
    {
      clientId: "new",
      clientName: "Sample Shop",
      deliveryRegion: "Luzon",
      receiptDetails: { address: "12 Main St" },
    },
    {
      clientId: "old",
      clientName: " sample shop ",
      deliveryRegion: "Metro Manila",
    },
    { clientId: "empty", clientName: "  " },
    {
      clientId: "another",
      clientName: "Another Shop",
      deliveryRegion: "Visayas",
    },
  ] as ReceiptOrder[];
  assert.deepEqual(existingCustomers(orders), [
    { id: "another", name: "Another Shop", address: "", region: "Visayas" },
    { id: "new", name: "Sample Shop", address: "12 Main St", region: "Luzon" },
  ]);
});

test("large receipts preserve every item exactly once across pages, including exact boundaries", () => {
  for (const count of [1, 12, 13, 24, 30, 31, 100]) {
    const items = Array.from({ length: count }, (_, i) => i + 1);
    const pages = receiptPages(items);
    assert.equal(pages.length, Math.ceil(count / 12));
    assert.deepEqual(pages.flat(), items);
    assert.ok(pages.every((page) => page.length > 0 && page.length <= 12));
  }
});

const groupLines = [
  { id: "a", quantity: 2, unitPrice: 100 },
  { id: "b", quantity: 1, unitPrice: 50 },
  { id: "c", quantity: 3, unitPrice: 10 },
] as CartLine[];
test("group discounts apply to separate item ranges and preserve extra order discount", () => {
  const result = groupedOrderTotals(groupLines, [
    { afterLineId: "c", type: "amount", value: 5 },
    { afterLineId: "b", type: "percent", value: 10 },
  ], 2);
  assert.equal(result.valid, true);
  assert.equal(result.subtotal, 280);
  assert.equal(result.discount, 32);
  assert.equal(result.total, 248);
  assert.deepEqual(result.groups.map(d => [d.startPosition, d.afterPosition, d.base, d.amount]), [[0, 1, 250, 25], [2, 2, 30, 5]]);
});
test("invalid group discounts and missing or duplicate boundaries cannot save", () => {
  for (const value of [-1, 101, NaN, Infinity, 0.001]) {
    assert.equal(groupedOrderTotals(groupLines, [{afterLineId: "a", type: "percent", value}]).valid, false);
  }
  assert.equal(groupedOrderTotals(groupLines, [{afterLineId: "a", type: "amount", value: 201}]).valid, false);
  assert.equal(groupedOrderTotals(groupLines, [{afterLineId: "missing", type: "amount", value: 1}]).valid, false);
  const discount = {afterLineId: "a", type: "amount" as const, value: 1};
  assert.equal(groupedOrderTotals(groupLines, [discount, discount]).valid, false);
  assert.equal(groupedOrderTotals(groupLines, [discount], 280).valid, false);
});
test("percentage discounts round to cents and recompute after quantity changes", () => {
  const discount = [{afterLineId: "a", type: "percent" as const, value: 33.33}];
  assert.equal(groupedOrderTotals(groupLines, discount).groups[0].amount, 66.66);
  assert.equal(groupedOrderTotals([{...groupLines[0], quantity: 1}], discount).groups[0].amount, 33.33);
  assert.equal(groupedOrderTotals(groupLines, [], 5).total, orderTotals(groupLines, 5).total);
});
