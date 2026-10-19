/**
 * @file transfers.service.ts
 * @description
 *   Core business logic service for internal warehouse transfers.
 *   Enforces strict inventory rules:
 *     - Source and destination warehouses must be different
 *     - Quantity must be strictly positive
 *     - State transitions: pending -> in_transit -> received
 *     - Cancellation allowed from pending or in_transit states
 *     - Rollback / reversal audit trail on cancellations
 */

import { AppError } from '../middleware/errorHandler';
import {
  TransferDto,
  InitiateTransferPayload,
  DispatchTransferPayload,
  ReceiveTransferPayload,
  CancelTransferPayload,
  TransferFilterQuery,
} from '../types/transfers.types';

// In-memory persistent transfer registry (synced with transactions)
const transfersStore: Map<string, TransferDto> = new Map();

// Audit log entries for transfer adjustments
interface StockAuditEntry {
  id: string;
  transferId: string;
  productId: string;
  warehouseId: string;
  adjustmentAmount: number;
  reason: string;
  recordedBy: string;
  timestamp: string;
}

const auditLogStore: StockAuditEntry[] = [];

/**
 * Initiates one or more internal warehouse transport requests.
 */
export async function initiateTransfers(payload: InitiateTransferPayload): Promise<TransferDto[]> {
  const { sourceWarehouseId, destinationWarehouseId, items, initiatedBy, notes } = payload;

  if (!sourceWarehouseId || !destinationWarehouseId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Source and destination warehouses are required.');
  }

  if (sourceWarehouseId === destinationWarehouseId) {
    throw new AppError(400, 'INVALID_TRANSFER', 'Source and destination warehouses must be different.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At least one product item must be specified for transfer.');
  }

  const createdTransfers: TransferDto[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    if (!item.productId || typeof item.productId !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Each transfer item must have a valid productId.');
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new AppError(400, 'INVALID_QUANTITY', `Quantity for product ${item.productId} must be greater than zero.`);
    }

    const transferId = `tfr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const transfer: TransferDto = {
      id: transferId,
      sourceWarehouseId,
      destinationWarehouseId,
      productId: item.productId,
      quantity: item.quantity,
      status: 'pending',
      initiatedBy: initiatedBy || 'system',
      notes,
      createdAt: now,
      updatedAt: now,
    };

    transfersStore.set(transferId, transfer);
    createdTransfers.push(transfer);
  }

  return createdTransfers;
}

/**
 * Dispatches a transfer, transitioning status to 'in_transit' and logging deduction.
 */
export async function dispatchTransfer(
  transferId: string,
  payload: DispatchTransferPayload
): Promise<TransferDto> {
  const transfer = transfersStore.get(transferId);
  if (!transfer) {
    throw new AppError(404, 'NOT_FOUND', `Transfer request "${transferId}" not found.`);
  }

  if (transfer.status !== 'pending') {
    throw new AppError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot dispatch transfer in status "${transfer.status}". Only "pending" transfers can be dispatched.`
    );
  }

  const now = new Date().toISOString();
  transfer.status = 'in_transit';
  transfer.driverName = payload.driverName?.trim();
  transfer.vehiclePlate = payload.vehiclePlate?.trim().toUpperCase();
  transfer.dispatchedAt = now;
  transfer.dispatchedBy = payload.dispatchedBy;
  transfer.updatedAt = now;

  // Record audit log for stock deduction at origin
  auditLogStore.push({
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    transferId: transfer.id,
    productId: transfer.productId,
    warehouseId: transfer.sourceWarehouseId,
    adjustmentAmount: -transfer.quantity,
    reason: `Dispatched in_transit via ${payload.driverName || 'Courier'} (${payload.vehiclePlate || 'N/A'})`,
    recordedBy: payload.dispatchedBy || 'system',
    timestamp: now,
  });

  transfersStore.set(transferId, transfer);
  return transfer;
}

/**
 * Confirms arrival at destination warehouse, transitioning status to 'received'.
 */
export async function receiveTransfer(
  transferId: string,
  payload: ReceiveTransferPayload
): Promise<TransferDto> {
  const transfer = transfersStore.get(transferId);
  if (!transfer) {
    throw new AppError(404, 'NOT_FOUND', `Transfer request "${transferId}" not found.`);
  }

  if (transfer.status !== 'in_transit') {
    throw new AppError(
      400,
      'INVALID_STATUS_TRANSITION',
      `Cannot receive transfer with status "${transfer.status}". Transfer must be "in_transit" to receive.`
    );
  }

  const now = new Date().toISOString();
  transfer.status = 'received';
  transfer.receivedAt = now;
  transfer.receivedBy = payload.receivedBy;
  if (payload.notes) transfer.notes = (transfer.notes ? `${transfer.notes} | ` : '') + payload.notes;
  transfer.updatedAt = now;

  // Record audit log for stock arrival at destination
  auditLogStore.push({
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    transferId: transfer.id,
    productId: transfer.productId,
    warehouseId: transfer.destinationWarehouseId,
    adjustmentAmount: transfer.quantity,
    reason: `Received at destination warehouse`,
    recordedBy: payload.receivedBy || 'system',
    timestamp: now,
  });

  transfersStore.set(transferId, transfer);
  return transfer;
}

/**
 * Cancels a transfer and rolls back origin stock if it had been dispatched.
 */
export async function cancelTransfer(
  transferId: string,
  payload: CancelTransferPayload
): Promise<TransferDto> {
  const transfer = transfersStore.get(transferId);
  if (!transfer) {
    throw new AppError(404, 'NOT_FOUND', `Transfer request "${transferId}" not found.`);
  }

  if (transfer.status === 'received') {
    throw new AppError(400, 'CANNOT_CANCEL', 'Cannot cancel a transfer that has already been confirmed and received.');
  }

  if (transfer.status === 'cancelled') {
    throw new AppError(400, 'ALREADY_CANCELLED', 'This transfer has already been cancelled.');
  }

  if (!payload.cancellationReason || payload.cancellationReason.trim().length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A cancellation reason is required.');
  }

  const wasInTransit = transfer.status === 'in_transit';
  const now = new Date().toISOString();

  transfer.status = 'cancelled';
  transfer.cancellationReason = payload.cancellationReason.trim();
  transfer.cancelledAt = now;
  transfer.cancelledBy = payload.cancelledBy;
  transfer.updatedAt = now;

  // If already dispatched, revert stock at source warehouse
  if (wasInTransit) {
    auditLogStore.push({
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      transferId: transfer.id,
      productId: transfer.productId,
      warehouseId: transfer.sourceWarehouseId,
      adjustmentAmount: transfer.quantity,
      reason: `Cancelled while in_transit: ${payload.cancellationReason}. Stock reinstated.`,
      recordedBy: payload.cancelledBy || 'system',
      timestamp: now,
    });
  }

  transfersStore.set(transferId, transfer);
  return transfer;
}

/**
 * Retrieves a single transfer by ID.
 */
export async function getTransferById(transferId: string): Promise<TransferDto> {
  const transfer = transfersStore.get(transferId);
  if (!transfer) {
    throw new AppError(404, 'NOT_FOUND', `Transfer "${transferId}" not found.`);
  }
  return transfer;
}

/**
 * Lists transfers with filtering and pagination.
 */
export async function listTransfers(query: TransferFilterQuery): Promise<{
  items: TransferDto[];
  total: number;
  page: number;
  pageSize: number;
}> {
  let list = Array.from(transfersStore.values());

  if (query.status && query.status !== 'all') {
    list = list.filter(t => t.status === query.status);
  }

  if (query.warehouseId && query.warehouseId !== 'all') {
    list = list.filter(
      t => t.sourceWarehouseId === query.warehouseId || t.destinationWarehouseId === query.warehouseId
    );
  }

  // Sort newest first
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const skip = (page - 1) * pageSize;
  const paginated = list.slice(skip, skip + pageSize);

  return {
    items: paginated,
    total: list.length,
    page,
    pageSize,
  };
}

/**
 * Returns audit log entries for transfers.
 */
export async function getTransferAuditLogs(transferId?: string): Promise<StockAuditEntry[]> {
  if (transferId) {
    return auditLogStore.filter(a => a.transferId === transferId);
  }
  return auditLogStore;
}
