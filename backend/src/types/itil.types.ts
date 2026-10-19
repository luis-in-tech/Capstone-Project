/**
 * @file itil.types.ts
 * @description Type definitions for ITIL SLA Monitoring and Defective Stock Quarantine subsystems (FR-06 & FR-11).
 */

export interface DelayedCIDto {
  sku: string;
  name: string;
  quantity: number;
}

export interface ITILSlaIncidentDto {
  id: string;
  orderId: string;
  orderNumber: string;
  clientName: string;
  deliveryRegion: string;
  deliveryDeadline: string;
  daysOverdue: number;
  status: 'active' | 'escalated' | 'resolved';
  severity: 'high' | 'critical';
  escalatedTo: string; // e.g. "Chief Marketing Officer (CMO)", "Supply Chain Manager"
  delayedCIs: DelayedCIDto[];
  createdAt: string;
  updatedAt: string;
}

export interface QuarantineTicketDto {
  id: string;
  ticketNumber: string;
  sku: string;
  productName: string;
  warehouseId: string;
  quantity: number;
  defectCategory: 'shipping_damage' | 'manufacturing_defect' | 'expired_shelf_life' | 'packaging_torn';
  severity: 'minor' | 'moderate' | 'critical';
  reportedBy: string;
  status: 'quarantined' | 'returned_to_supplier' | 'written_off';
  supplierReturnBatchId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuarantineTicketPayload {
  sku: string;
  productName: string;
  warehouseId: string;
  quantity: number;
  defectCategory: 'shipping_damage' | 'manufacturing_defect' | 'expired_shelf_life' | 'packaging_torn';
  severity: 'minor' | 'moderate' | 'critical';
  reportedBy: string;
  notes?: string;
}

export interface QuarantineFilterQuery {
  warehouseId?: string;
  defectCategory?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}
