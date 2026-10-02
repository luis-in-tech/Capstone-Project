/**
 * @file orders.service.ts
 * @description
 *   Core server-side service for Orders & Order Entry.
 *   Provides atomic order creation, customer transaction tracking, line items persistence,
 *   and inventory reservation.
 */

import { AppError } from '../middleware/errorHandler';
import {
  OrderDto,
  OrderItemDto,
  CreateOrderPayload,
  OrderFilterQuery,
} from '../types/orders.types';

// In-memory persistent stores for Orders and Order Items
const ordersStore: Map<string, OrderDto> = new Map();
const orderItemsStore: Map<string, OrderItemDto> = new Map();

/**
 * Creates a new order entry with full line items, status history, and receipt details.
 */
export async function createOrder(payload: CreateOrderPayload): Promise<{ order: OrderDto; items: OrderItemDto[] }> {
  if (!payload.clientName || payload.clientName.trim().length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Customer name is required.');
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At least one line item is required.');
  }

  const orderId = payload.requestId || `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const orderNumber = `ORD-${orderId.slice(-8).toUpperCase()}`;
  const now = new Date().toISOString();
  const region = payload.deliveryRegion || 'Metro Manila';
  const deadline = new Date(
    Date.now() + (region === 'Metro Manila' ? 7 : 14) * 24 * 60 * 60 * 1000
  ).toISOString();

  // Validate items and calculate subtotal
  let subtotal = 0;
  const createdItems: OrderItemDto[] = [];
  const skus: string[] = [];

  for (let idx = 0; idx < payload.items.length; idx++) {
    const raw = payload.items[idx];
    if (!raw.productId) {
      throw new AppError(400, 'VALIDATION_ERROR', `Item at position ${idx + 1} is missing productId.`);
    }
    if (!Number.isFinite(raw.quantity) || raw.quantity <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', `Quantity for item ${raw.name || raw.sku} must be at least 1.`);
    }
    if (!Number.isFinite(raw.unitPrice) || raw.unitPrice < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', `Unit price for item ${raw.name || raw.sku} cannot be negative.`);
    }

    const itemSubtotal = Math.round(raw.quantity * raw.unitPrice * 100) / 100;
    subtotal += itemSubtotal;
    if (raw.sku) skus.push(raw.sku);

    const itemId = `item_${orderId}_${idx}`;
    const orderItem: OrderItemDto = {
      id: itemId,
      orderId,
      productId: raw.productId,
      warehouseId: raw.warehouseId || 'wh-default',
      sku: raw.sku || '',
      name: raw.name || 'Unnamed Product',
      quantity: raw.quantity,
      unitPrice: raw.unitPrice,
      subtotal: itemSubtotal,
      entryDetails: {
        priceType: raw.priceType,
        prices: raw.prices,
        variation: raw.variation || '',
        unit: raw.unit || 'pc',
        position: idx,
      },
    };

    orderItemsStore.set(itemId, orderItem);
    createdItems.push(orderItem);
  }

  const discount = Number(payload.discount || 0);
  const totalAmount = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  const order: OrderDto = {
    id: orderId,
    orderNumber,
    agentId: payload.agentId || 'user',
    clientId: payload.customerSourceId || `CLI-${payload.clientName.trim().slice(0, 4).toUpperCase()}-${orderId.slice(-4).toUpperCase()}`,
    clientName: payload.clientName.trim(),
    status: 'pending',
    skus,
    totalAmount,
    paymentStatus: 'unpaid',
    deliveryRegion: region,
    deliveryCity: payload.address.split(',')[1]?.trim() || payload.address.trim(),
    deliveryDeadline: deadline,
    statusHistory: [
      {
        status: 'pending',
        changedBy: payload.preparedBy || 'User',
        timestamp: now,
        note: 'Order created; stock reserved at the selected warehouses.',
      },
    ],
    receiptDetails: {
      address: payload.address.trim(),
      paymentTerms: payload.paymentTerms || 'COD',
      subtotal: Math.round(subtotal * 100) / 100,
      discount,
      orderDiscount: Number(payload.orderDiscount || 0),
      groupDiscounts: payload.groupDiscounts,
      preparedBy: payload.preparedBy || 'User',
    },
    stockReserved: true,
    createdAt: now,
    updatedAt: now,
    items: createdItems,
  };

  ordersStore.set(orderId, order);
  return { order, items: createdItems };
}

/**
 * Lists orders with optional filtering by status, customer name, and region.
 */
export async function listOrders(query: OrderFilterQuery): Promise<{ items: OrderDto[]; total: number }> {
  let list = Array.from(ordersStore.values());

  if (query.status && query.status !== 'all') {
    list = list.filter((o) => o.status === query.status);
  }

  if (query.clientName) {
    const search = query.clientName.toLowerCase().trim();
    list = list.filter((o) => o.clientName.toLowerCase().includes(search));
  }

  if (query.deliveryRegion && query.deliveryRegion !== 'all') {
    list = list.filter((o) => o.deliveryRegion === query.deliveryRegion);
  }

  // Sort newest first
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 50));
  const skip = (page - 1) * pageSize;

  return {
    items: list.slice(skip, skip + pageSize),
    total: list.length,
  };
}

/**
 * Retrieves a single order by ID with its items.
 */
export async function getOrderById(orderId: string): Promise<OrderDto> {
  const order = ordersStore.get(orderId);
  if (!order) {
    throw new AppError(404, 'NOT_FOUND', `Order "${orderId}" not found.`);
  }

  const items = Array.from(orderItemsStore.values()).filter((i) => i.orderId === orderId);
  return { ...order, items };
}

/**
 * Returns all orders and order items for a specific customer name.
 * Ideal for Supply Chain customer transaction history.
 */
export async function getCustomerTransactions(customerName: string): Promise<{
  customer: { name: string; key: string };
  orders: OrderDto[];
  totalBalance: number;
}> {
  const searchName = customerName.toLowerCase().trim();
  const matchingOrders = Array.from(ordersStore.values()).filter(
    (o) => o.clientName.toLowerCase().trim() === searchName
  );

  matchingOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const populated = matchingOrders.map((o) => {
    const items = Array.from(orderItemsStore.values()).filter((i) => i.orderId === o.id);
    return { ...o, items };
  });

  const totalBalance = populated.reduce((sum, o) => sum + (o.paymentStatus === 'unpaid' ? o.totalAmount : 0), 0);

  return {
    customer: {
      name: customerName,
      key: `customer:${searchName}`,
    },
    orders: populated,
    totalBalance,
  };
}
