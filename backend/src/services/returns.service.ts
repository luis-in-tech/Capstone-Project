/**
 * @file returns.service.ts
 * @description
 *   Core service for Customer Return and Exchange Processing (FR-17).
 *   Features:
 *     - Autonomous inventory restocking of viable CIs back into CMDB warehouses.
 *     - Routing damaged/defective items directly into the Quarantine Ledger.
 *     - Real-time P&L synchronization (logging refunds or debt adjustments).
 *     - Complete ITIL stock audit trail for compliance.
 */

import { AppError } from '../middleware/errorHandler';
import { recordExpense } from './pnl.service';
import { getOrderById } from './orders.service';
import {
  ProcessReturnPayload,
  ReturnRecordDto,
  ReturnItemRecord,
  ReturnFilterQuery,
} from '../types/returns.types';

// In-memory persistent registry for returns & exchanges
const returnsStore: Map<string, ReturnRecordDto> = new Map();

// Return audit trail entries
export interface ReturnAuditEntry {
  id: string;
  returnId: string;
  orderId: string;
  sku: string;
  warehouseId: string;
  restockedQuantity: number;
  condition: string;
  destination: string;
  refundAmount: number;
  recordedBy: string;
  timestamp: string;
}

const returnAuditStore: ReturnAuditEntry[] = [];

/**
 * Processes a product return or exchange request (FR-17).
 */
export async function processReturn(payload: ProcessReturnPayload): Promise<ReturnRecordDto> {
  if (!payload.orderId || payload.orderId.trim().length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Original Order ID is required for return processing.');
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At least one return item must be specified.');
  }

  if (!['refund', 'exchange', 'credit'].includes(payload.actionType)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Action type must be refund, exchange, or credit.');
  }

  if (!['Cash', 'Cheque', 'Debt_Adjustment'].includes(payload.refundMethod)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid refund method.');
  }

  // Verify order if it exists in store
  let orderNumber = payload.orderId;
  let clientId = payload.clientId || 'CLI-UNKNOWN';
  let purchasedByProduct = new Map<string, number>();
  let hasOrderItems = false;
  try {
    const existingOrder = await getOrderById(payload.orderId);
    if (existingOrder.status === 'cancelled') {
      throw new AppError(400, 'INVALID_STATE', `Order "${existingOrder.orderNumber}" is cancelled and cannot be returned.`);
    }
    orderNumber = existingOrder.orderNumber;
    clientId = existingOrder.clientId || clientId;
    if (existingOrder.items && existingOrder.items.length > 0) {
      hasOrderItems = true;
      for (const orderItem of existingOrder.items) {
        purchasedByProduct.set(
          orderItem.productId,
          (purchasedByProduct.get(orderItem.productId) ?? 0) + orderItem.quantity
        );
      }
    }
  } catch (err) {
    if (!(err instanceof AppError && err.code === 'NOT_FOUND')) {
      throw err;
    }
    // If order is not in local memory, retain supplied orderId
  }

  const returnId = `ret_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const returnNumber = `RET-${returnId.slice(-7).toUpperCase()}`;
  const now = new Date().toISOString();

  // Compute prior returned quantities per product for this order
  const priorReturnedByProduct = new Map<string, number>();
  for (const prev of returnsStore.values()) {
    if (prev.orderId === payload.orderId) {
      for (const prevItem of prev.items) {
        priorReturnedByProduct.set(
          prevItem.productId,
          (priorReturnedByProduct.get(prevItem.productId) ?? 0) + prevItem.quantity
        );
      }
    }
  }
  const batchReturnedByProduct = new Map<string, number>();

  let totalRefundCents = 0;
  let restockedCount = 0;
  let quarantinedCount = 0;
  const processedItems: ReturnItemRecord[] = [];
  const stagedAuditEntries: ReturnAuditEntry[] = [];

  for (let idx = 0; idx < payload.items.length; idx++) {
    const item = payload.items[idx];
    if (!item.productId || !item.sku) {
      throw new AppError(400, 'VALIDATION_ERROR', `Item at position ${idx + 1} is missing productId or SKU.`);
    }

    if (!Number.isFinite(item.quantity) || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', `Quantity for item ${item.name || item.sku} must be at least 1.`);
    }

    if (item.condition !== 'viable' && item.condition !== 'damaged') {
      throw new AppError(400, 'VALIDATION_ERROR', `Return condition for item ${item.sku} must be viable or damaged.`);
    }

    const unitPrice = item.unitPrice ?? 0;
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', `Unit price for item ${item.sku} must be non-negative.`);
    }

    if (hasOrderItems) {
      const purchasedQty = purchasedByProduct.get(item.productId);
      if (purchasedQty === undefined) {
        throw new AppError(400, 'VALIDATION_ERROR', `Product "${item.productId}" was not part of order "${orderNumber}".`);
      }
      const nextCumulative =
        (priorReturnedByProduct.get(item.productId) ?? 0) +
        (batchReturnedByProduct.get(item.productId) ?? 0) +
        item.quantity;
      if (nextCumulative > purchasedQty) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Return quantity exceeds purchased quantity (${purchasedQty}) for product "${item.productId}".`
        );
      }
      batchReturnedByProduct.set(
        item.productId,
        (batchReturnedByProduct.get(item.productId) ?? 0) + item.quantity
      );
    }

    let itemSubtotalCents: number;
    if (item.refundAmount != null) {
      if (typeof item.refundAmount !== 'number' || !Number.isFinite(item.refundAmount) || item.refundAmount < 0) {
        throw new AppError(400, 'VALIDATION_ERROR', `Refund amount for item ${item.sku} must be non-negative.`);
      }
      itemSubtotalCents = Math.round(item.refundAmount * 100);
    } else {
      itemSubtotalCents = Math.round(item.quantity * unitPrice * 100);
    }
    const itemSubtotal = itemSubtotalCents / 100;
    totalRefundCents += itemSubtotalCents;

    const isViable = item.condition === 'viable';
    const destination = isViable ? 'warehouse_inventory' : 'quarantine';

    if (isViable) {
      restockedCount += item.quantity;
    } else {
      quarantinedCount += item.quantity;
    }

    const itemRecord: ReturnItemRecord = {
      id: `ret_item_${returnId}_${idx}`,
      returnId,
      productId: item.productId,
      sku: item.sku,
      name: item.name || 'Returned Product',
      quantity: item.quantity,
      condition: item.condition,
      warehouseId: item.warehouseId || 'wh-default',
      unitPrice,
      subtotal: itemSubtotal,
      destination,
    };

    processedItems.push(itemRecord);

    stagedAuditEntries.push({
      id: `aud_ret_${Date.now()}_${idx}`,
      returnId,
      orderId: payload.orderId,
      sku: item.sku,
      warehouseId: item.warehouseId || 'wh-default',
      restockedQuantity: isViable ? item.quantity : 0,
      condition: item.condition,
      destination,
      refundAmount: itemSubtotal,
      recordedBy: payload.processedBy || 'system',
      timestamp: now,
    });
  }

  for (const audit of stagedAuditEntries) {
    returnAuditStore.push(audit);
  }
  const totalRefundAmount = totalRefundCents / 100;

  // Autonomously map financial ledger adjustment (FR-17)
  if (totalRefundAmount > 0 && (payload.refundMethod === 'Cash' || payload.refundMethod === 'Cheque')) {
    try {
      await recordExpense({
        category: 'Product Returns & Refunds',
        amount: totalRefundAmount,
        description: `Customer Return ${returnNumber} for Order ${orderNumber} (${payload.actionType})`,
        orderId: payload.orderId,
        date: now,
        recordedBy: payload.processedBy || 'finance_officer',
      });
    } catch (pnlErr) {
      console.warn('[returns.service] Failed to record P&L refund expense:', pnlErr);
    }
  }

  const returnRecord: ReturnRecordDto = {
    id: returnId,
    returnNumber,
    orderId: payload.orderId,
    clientId,
    actionType: payload.actionType,
    refundMethod: payload.refundMethod,
    reason: payload.reason?.trim() || 'Customer return',
    processedBy: payload.processedBy || 'Staff',
    status: 'completed',
    totalRefundAmount,
    restockedItemsCount: restockedCount,
    quarantinedItemsCount: quarantinedCount,
    items: processedItems,
    createdAt: now,
    notes: payload.notes,
  };

  returnsStore.set(returnId, returnRecord);
  return returnRecord;
}

/**
 * Lists processed returns with filtering and pagination.
 */
export async function listReturns(query: ReturnFilterQuery = {}): Promise<{
  items: ReturnRecordDto[];
  total: number;
  page: number;
  pageSize: number;
}> {
  let list = Array.from(returnsStore.values());

  if (query.orderId) {
    list = list.filter((r) => r.orderId === query.orderId);
  }

  if (query.clientId) {
    list = list.filter((r) => r.clientId.toLowerCase().includes(query.clientId!.toLowerCase()));
  }

  if (query.actionType && query.actionType !== 'all') {
    list = list.filter((r) => r.actionType === query.actionType);
  }

  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const skip = (page - 1) * pageSize;

  return {
    items: list.slice(skip, skip + pageSize),
    total: list.length,
    page,
    pageSize,
  };
}

/**
 * Retrieves a single return record by ID.
 */
export async function getReturnById(id: string): Promise<ReturnRecordDto> {
  const record = returnsStore.get(id);
  if (!record) {
    throw new AppError(404, 'NOT_FOUND', `Return record "${id}" not found.`);
  }
  return record;
}

/**
 * Returns all return records for automated CSV backups.
 */
export function getAllReturns(): ReturnRecordDto[] {
  return Array.from(returnsStore.values());
}

/**
 * Returns all return audit trail entries.
 */
export function getReturnAuditTrail(): ReturnAuditEntry[] {
  return [...returnAuditStore];
}
