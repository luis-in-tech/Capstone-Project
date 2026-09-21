import type { Order, OrderItem, Product } from "../types";

export const priceLabels = {
  regular: "Regular",
  mm: "Metro Manila",
  provincial: "Provincial",
  promo: "Promo",
  custom: "Custom Price",
} as const;
export type SellingPrice = keyof typeof priceLabels;
export type PriceSnapshot = Record<
  "regular" | "mm" | "provincial" | "promo" | "cost",
  number | null
>;
export interface CartLine {
  id: string;
  productId: string;
  sku: string;
  name: string;
  variation: string;
  unit: string;
  quantity: number;
  warehouseId: string;
  priceType: SellingPrice;
  unitPrice: number;
  prices: PriceSnapshot;
}
export interface ReceiptDetails {
  address: string;
  paymentTerms: string;
  subtotal: number;
  discount: number;
  preparedBy: string;
  groupDiscounts?: GroupDiscountResult[];
  orderDiscount?: number;
}
export interface GroupDiscount {
  afterLineId: string;
  type: "percent" | "amount";
  value: number;
}
export interface GroupDiscountResult extends GroupDiscount {
  afterPosition: number;
  startPosition: number;
  base: number;
  amount: number;
}
export function groupedOrderTotals(lines: CartLine[], discounts: GroupDiscount[], orderDiscount = 0) {
  let startPosition = 0;
  let valid = true;
  const groups: GroupDiscountResult[] = [];
  lines.forEach((line, afterPosition) => {
    const discount = discounts.find(d => d.afterLineId === line.id);
    if (!discount) return;
    const base = orderTotals(lines.slice(startPosition, afterPosition + 1), 0).subtotal;
    const amount = discount.type === "percent" ? roundMoney(base * discount.value / 100) : discount.value;
    valid &&= Number.isFinite(discount.value) && discount.value >= 0 && roundMoney(discount.value) === discount.value &&
      (discount.type !== "percent" || discount.value <= 100) && amount <= base;
    groups.push({ ...discount, afterPosition, startPosition, base, amount });
    startPosition = afterPosition + 1;
  });
  valid &&= groups.length === discounts.length && new Set(discounts.map(d => d.afterLineId)).size === discounts.length;
  const totals = orderTotals(lines, roundMoney(groups.reduce((sum, d) => sum + d.amount, 0) + orderDiscount));
  return { ...totals, valid: valid && totals.valid && orderDiscount >= 0 && roundMoney(orderDiscount) === orderDiscount, groups };
}
export type ReceiptOrder = Order & {
  receiptDetails?: ReceiptDetails;
  stockReserved?: boolean;
};
export type ReceiptItem = OrderItem & {
  entryDetails?: Pick<CartLine, "variation" | "unit" | "priceType" | "prices"> & { position?: number };
};
export const money = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    value,
  );
export const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
export function productPrices(product: Product): PriceSnapshot {
  return {
    regular: product.basePrice ?? null,
    mm: product.mmPrice ?? product.wholesalePrice ?? null,
    provincial: product.provincialPrice ?? product.dealerPrice ?? null,
    promo: product.promoPrice ?? null,
    cost: product.costPrice ?? null,
  };
}
export function orderTotals(
  lines: Pick<CartLine, "quantity" | "unitPrice">[],
  discount: number,
) {
  const subtotal = roundMoney(
    lines.reduce(
      (sum, line) => sum + roundMoney(line.quantity * line.unitPrice),
      0,
    ),
  );
  return {
    subtotal,
    discount,
    total: roundMoney(subtotal - discount),
    valid:
      Number.isFinite(discount) &&
      discount >= 0 &&
      discount <= subtotal &&
      roundMoney(discount) === discount,
  };
}
// Use the same name grouping as Supply Chain, limited to orders visible to this user.
export function existingCustomers(orders: ReceiptOrder[]) {
  const customers = new Map<
    string,
    { id: string; name: string; address: string; region: string }
  >();
  for (const order of orders) {
    const key = order.clientName?.trim().toLowerCase();
    if (key && !customers.has(key))
      customers.set(key, {
        id: order.clientId,
        name: order.clientName,
        address: order.receiptDetails?.address || "",
        region: order.deliveryRegion,
      });
  }
  return [...customers.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export const RECEIPT_PAGE_SIZE = 12;
export function receiptPages<T>(
  items: T[],
  pageSize = RECEIPT_PAGE_SIZE,
): T[][] {
  return Array.from(
    { length: Math.max(1, Math.ceil(items.length / pageSize)) },
    (_, i) => items.slice(i * pageSize, (i + 1) * pageSize),
  );
}
