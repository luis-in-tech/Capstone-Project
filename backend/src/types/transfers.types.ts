/**
 * @file transfers.types.ts
 * @description Type definitions for the Transfers backend module.
 */

export type TransferStatus = 'pending' | 'in_transit' | 'received' | 'cancelled';

export interface TransferItem {
  id?: string;
  productId: string;
  quantity: number;
}

export interface TransferDto {
  id: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  productId: string;
  quantity: number;
  status: TransferStatus;
  driverName?: string;
  vehiclePlate?: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  receivedAt?: string;
  receivedBy?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  notes?: string;
  initiatedBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface InitiateTransferPayload {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  initiatedBy: string;
  notes?: string;
}

export interface DispatchTransferPayload {
  driverName?: string;
  vehiclePlate?: string;
  dispatchedBy: string;
}

export interface ReceiveTransferPayload {
  receivedBy: string;
  notes?: string;
}

export interface CancelTransferPayload {
  cancellationReason: string;
  cancelledBy: string;
}

export interface TransferFilterQuery {
  status?: TransferStatus | 'all';
  warehouseId?: string;
  page?: number;
  pageSize?: number;
}
