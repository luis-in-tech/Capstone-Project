/**
 * @file returns.types.ts
 * @description Type definitions for the Returns & Exchange backend subsystem (FR-17).
 */

export type ReturnCondition = 'viable' | 'damaged';
export type ReturnActionType = 'refund' | 'exchange' | 'credit';
export type ReturnRefundMethod = 'Cash' | 'Cheque' | 'Debt_Adjustment';

export interface ReturnItemPayload {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  condition: ReturnCondition;
  warehouseId: string;
  unitPrice: number;
  refundAmount?: number;
}

export interface ReturnItemRecord {
  id: string;
  returnId: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  condition: ReturnCondition;
  warehouseId: string;
  unitPrice: number;
  subtotal: number;
  destination: 'warehouse_inventory' | 'quarantine';
}

export interface ProcessReturnPayload {
  orderId: string;
  clientId?: string;
  actionType: ReturnActionType;
  items: ReturnItemPayload[];
  refundMethod: ReturnRefundMethod;
  reason: string;
  processedBy: string;
  notes?: string;
}

export interface ReturnRecordDto {
  id: string;
  returnNumber: string;
  orderId: string;
  clientId: string;
  actionType: ReturnActionType;
  refundMethod: ReturnRefundMethod;
  reason: string;
  processedBy: string;
  status: 'completed' | 'processing';
  totalRefundAmount: number;
  restockedItemsCount: number;
  quarantinedItemsCount: number;
  items: ReturnItemRecord[];
  createdAt: string;
  notes?: string;
}

export interface ReturnFilterQuery {
  orderId?: string;
  clientId?: string;
  actionType?: string;
  page?: number;
  pageSize?: number;
}
