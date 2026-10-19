/**
 * @file orders.types.ts
 * @description Type definitions for the Orders & Order Entry backend module.
 */

export interface OrderItemDto {
  id: string;
  orderId: string;
  productId: string;
  warehouseId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  entryDetails?: {
    priceType?: string;
    prices?: Record<string, number | null>;
    variation?: string;
    unit?: string;
    position?: number;
  };
}

export interface OrderStatusHistoryItem {
  status: string;
  changedBy: string;
  timestamp: string;
  note?: string;
}

export interface ReceiptDetailsDto {
  address: string;
  paymentTerms: string;
  subtotal: number;
  discount: number;
  orderDiscount?: number;
  groupDiscounts?: any[];
  preparedBy: string;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  agentId: string;
  clientId: string;
  clientName: string;
  status: 'pending' | 'in_transit' | 'delivered' | 'cancelled';
  skus: string[];
  totalAmount: number;
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  deliveryRegion: string;
  deliveryCity: string;
  deliveryDeadline: string;
  statusHistory: OrderStatusHistoryItem[];
  receiptDetails?: ReceiptDetailsDto;
  stockReserved?: boolean;
  createdAt: string;
  updatedAt: string;
  items?: OrderItemDto[];
}

export interface CreateOrderPayload {
  requestId?: string;
  customerSourceId?: string;
  clientName: string;
  address: string;
  deliveryRegion: string;
  paymentTerms: string;
  discount?: number;
  orderDiscount?: number;
  groupDiscounts?: any[];
  items: Array<{
    productId: string;
    warehouseId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    priceType?: string;
    prices?: Record<string, number | null>;
    variation?: string;
    unit?: string;
  }>;
  agentId?: string;
  preparedBy?: string;
}

export interface OrderFilterQuery {
  status?: string;
  clientName?: string;
  deliveryRegion?: string;
  page?: number;
  pageSize?: number;
}
