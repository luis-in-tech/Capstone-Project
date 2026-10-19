/**
 * @file itil.service.ts
 * @description
 *   Server-side ITIL Service Configuration Management (FR-06 & FR-11).
 *   Features:
 *     - Autonomous SLA Incident Monitoring & Automated Escalation (1-week Metro Manila, 2-week Mindanao).
 *     - Defective Stock Exception Logging & Quarantine Management.
 *     - Supplier Returns Defective Products Report CSV Generator.
 */

import { AppError } from '../middleware/errorHandler';
import { getAllOrders } from './orders.service';
import { buildCsv } from './databaseBackup.service';
import {
  ITILSlaIncidentDto,
  QuarantineTicketDto,
  CreateQuarantineTicketPayload,
  QuarantineFilterQuery,
} from '../types/itil.types';

// In-memory persistent stores
const quarantineStore: Map<string, QuarantineTicketDto> = new Map();
const slaIncidentsStore: Map<string, ITILSlaIncidentDto> = new Map();

/**
 * Baseline SLA thresholds in milliseconds:
 * - Metro Manila: 7 days
 * - Mindanao / Visayas / Rest of PH: 14 days
 */
const SLA_THRESHOLDS_MS = {
  metroManila: 7 * 24 * 60 * 60 * 1000,
  regional: 14 * 24 * 60 * 60 * 1000,
};

/**
 * Evaluates active orders against SLA timelines and triggers automated ITIL incidents (FR-06).
 */
export async function evaluateSlaIncidents(): Promise<{
  incidents: ITILSlaIncidentDto[];
  breachCount: number;
  evaluatedAt: string;
}> {
  const now = Date.now();
  const allOrders = getAllOrders();

  const activeOrders = allOrders.filter(
    (o) => o.status === 'pending' || o.status === 'in_transit'
  );

  const activeIncidents: ITILSlaIncidentDto[] = [];

  for (const order of activeOrders) {
    const createdAtMs = new Date(order.createdAt).getTime();
    const isMetroManila = (order.deliveryRegion || '').toLowerCase().includes('metro');
    const thresholdMs = isMetroManila ? SLA_THRESHOLDS_MS.metroManila : SLA_THRESHOLDS_MS.regional;
    const deadlineMs = order.deliveryDeadline ? new Date(order.deliveryDeadline).getTime() : createdAtMs + thresholdMs;

    if (now > deadlineMs) {
      const overdueMs = now - deadlineMs;
      const daysOverdue = Math.ceil(overdueMs / (24 * 60 * 60 * 1000));
      const severity = daysOverdue >= 3 ? 'critical' : 'high';
      const incidentId = `inc_sla_${order.id}`;

      const delayedCIs = (order.items || []).map((i) => ({
        sku: i.sku,
        name: i.name,
        quantity: i.quantity,
      }));

      const incident: ITILSlaIncidentDto = {
        id: incidentId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        clientName: order.clientName,
        deliveryRegion: order.deliveryRegion,
        deliveryDeadline: new Date(deadlineMs).toISOString(),
        daysOverdue,
        status: 'escalated',
        severity,
        escalatedTo: 'Chief Marketing Officer (CMO) & Logistics Dispatch Head',
        delayedCIs,
        createdAt: slaIncidentsStore.get(incidentId)?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      slaIncidentsStore.set(incidentId, incident);
      activeIncidents.push(incident);
    }
  }

  return {
    incidents: activeIncidents,
    breachCount: activeIncidents.length,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Creates an ITIL exception ticket for defective or damaged items, quarantining them (FR-11).
 */
export async function createQuarantineTicket(
  payload: CreateQuarantineTicketPayload
): Promise<QuarantineTicketDto> {
  if (!payload.sku || payload.sku.trim().length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Product SKU is required.');
  }

  if (!payload.warehouseId || payload.warehouseId.trim().length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Origin warehouse ID is required.');
  }

  if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Quarantine quantity must be at least 1.');
  }

  const id = `qrn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const ticketNumber = `QRN-${id.slice(-7).toUpperCase()}`;
  const now = new Date().toISOString();

  const ticket: QuarantineTicketDto = {
    id,
    ticketNumber,
    sku: payload.sku.trim().toUpperCase(),
    productName: payload.productName || 'Quarantined CI',
    warehouseId: payload.warehouseId.trim(),
    quantity: payload.quantity,
    defectCategory: payload.defectCategory || 'shipping_damage',
    severity: payload.severity || 'moderate',
    reportedBy: payload.reportedBy || 'warehouse_staff',
    status: 'quarantined',
    notes: payload.notes,
    createdAt: now,
    updatedAt: now,
  };

  quarantineStore.set(id, ticket);
  return ticket;
}

/**
 * Lists quarantined items with filtering and pagination.
 */
export async function listQuarantineTickets(
  query: QuarantineFilterQuery = {}
): Promise<{
  items: QuarantineTicketDto[];
  total: number;
  page: number;
  pageSize: number;
}> {
  let list = Array.from(quarantineStore.values());

  if (query.warehouseId && query.warehouseId !== 'all') {
    list = list.filter((q) => q.warehouseId === query.warehouseId);
  }

  if (query.defectCategory && query.defectCategory !== 'all') {
    list = list.filter((q) => q.defectCategory === query.defectCategory);
  }

  if (query.status && query.status !== 'all') {
    list = list.filter((q) => q.status === query.status);
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
 * Exports Defective Products Report for supplier returns into CSV (FR-11).
 */
export async function exportSupplierReturnsCsv(ticketIds?: string[]): Promise<string> {
  let tickets = Array.from(quarantineStore.values());

  if (ticketIds && ticketIds.length > 0) {
    tickets = tickets.filter((t) => ticketIds.includes(t.id));
  }

  const headers = [
    'Ticket Number',
    'SKU',
    'Product Name',
    'Origin Warehouse',
    'Defective Units',
    'Defect Category',
    'Severity',
    'Status',
    'Reported By',
    'Logged Date',
    'Notes',
  ];

  const rows = tickets.map((t) => [
    t.ticketNumber,
    t.sku,
    t.productName,
    t.warehouseId,
    t.quantity,
    t.defectCategory,
    t.severity,
    t.status,
    t.reportedBy,
    t.createdAt,
    t.notes || 'None',
  ]);

  return buildCsv(headers, rows);
}
