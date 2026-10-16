import { supabase } from './supabase';
import { db } from './supabaseAdapter';
import { collection, addDoc, setDoc, updateDoc, doc, serverTimestamp } from './supabaseAdapter';
import type { Order, ITILIncident, DefectiveStockTicket, UserProfile, InventoryItem } from '../types';

const ITIL_INCIDENTS_STORAGE_KEY = 'activepro_db_itil_incidents';
const DEFECTIVE_TICKETS_STORAGE_KEY = 'activepro_db_defective_tickets';

export function getLocalIncidents(): ITILIncident[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(ITIL_INCIDENTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalIncidents(incidents: ITILIncident[]) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(ITIL_INCIDENTS_STORAGE_KEY, JSON.stringify(incidents));
    window.dispatchEvent(new CustomEvent('activepro_incidents_changed', { detail: { incidents } }));
  } catch (e) {
    console.warn('Failed to persist ITIL incidents:', e);
  }
}

export function getLocalDefectiveTickets(): DefectiveStockTicket[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(DEFECTIVE_TICKETS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalDefectiveTickets(tickets: DefectiveStockTicket[]) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(DEFECTIVE_TICKETS_STORAGE_KEY, JSON.stringify(tickets));
    window.dispatchEvent(new CustomEvent('activepro_defective_tickets_changed', { detail: { tickets } }));
  } catch (e) {
    console.warn('Failed to persist defective tickets:', e);
  }
}

/**
 * FR-06: Evaluates active orders and auto-generates ITIL Incident tickets for SLA breaches.
 * Baseline: 7 days for Metro Manila, 14 days for Mindanao / Provincial.
 */
export async function evaluateAndSyncSLAIncidents(
  orders: Order[],
  currentUser?: UserProfile | null
): Promise<ITILIncident[]> {
  const currentIncidents = getLocalIncidents();
  const incidentsMap = new Map<string, ITILIncident>(currentIncidents.map((inc) => [inc.id, inc]));
  const orderIncidentMap = new Map<string, ITILIncident>();

  for (const inc of currentIncidents) {
    if (inc.orderId && inc.incidentType === 'SLA_BREACH') {
      orderIncidentMap.set(inc.orderId, inc);
    }
  }

  const now = Date.now();
  let hasChanges = false;

  for (const order of orders) {
    // Only check active orders
    if (['delivered', 'completed', 'cancelled'].includes(order.status)) {
      // If order was resolved/completed, auto-resolve any open SLA incident
      const existingInc = orderIncidentMap.get(order.id);
      if (existingInc && existingInc.status !== 'RESOLVED' && existingInc.status !== 'CLOSED') {
        const resolvedInc: ITILIncident = {
          ...existingInc,
          status: 'RESOLVED',
          resolvedAt: new Date().toISOString(),
          resolutionNotes: `Auto-resolved upon order fulfillment (${order.status}).`,
        };
        incidentsMap.set(resolvedInc.id, resolvedInc);
        hasChanges = true;
      }
      continue;
    }

    // Determine deadline
    let deadlineMs: number;
    if (order.deliveryDeadline) {
      deadlineMs = typeof order.deliveryDeadline?.toDate === 'function'
        ? order.deliveryDeadline.toDate().getTime()
        : new Date(order.deliveryDeadline).getTime();
    } else {
      const createdMs = order.createdAt ? new Date(order.createdAt).getTime() : now;
      const slaDays = order.deliveryRegion === 'Metro Manila' ? 7 : 14;
      deadlineMs = createdMs + slaDays * 24 * 60 * 60 * 1000;
    }

    if (now > deadlineMs) {
      const daysOverdue = Math.max(1, Math.floor((now - deadlineMs) / (24 * 60 * 60 * 1000)));
      const existingInc = orderIncidentMap.get(order.id);

      if (!existingInc) {
        // Auto-generate brand new ITIL incident record (FR-06)
        const newTicketNumber = `INC-SLA-${order.orderNumber.replace(/[^A-Za-z0-9]/g, '')}`;
        const newIncident: ITILIncident = {
          id: `inc-sla-${order.id}`,
          ticketNumber: newTicketNumber,
          incidentType: 'SLA_BREACH',
          severity: daysOverdue >= 3 ? 'CRITICAL' : 'HIGH',
          status: 'ESCALATED',
          orderId: order.id,
          orderNumber: order.orderNumber,
          clientId: order.clientId,
          clientName: order.clientName,
          deliveryLocation: order.deliveryRegion || 'Unspecified',
          daysOverdue,
          assignedAgentId: order.agentId,
          assignedAgentName: currentUser?.displayName || 'Assigned Field Agent',
          description: `ITIL SLA Breach: Fulfillment target exceeded for ${order.deliveryRegion || 'destination'}. Order is ${daysOverdue} day(s) overdue.`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        incidentsMap.set(newIncident.id, newIncident);
        orderIncidentMap.set(order.id, newIncident);
        hasChanges = true;

        // Try pushing to Supabase itil_incidents
        try {
          await addDoc(collection(db, 'itil_incidents'), {
            ...newIncident,
            serverTimestamp: serverTimestamp(),
          });
        } catch (e) {
          console.warn('Supabase itil_incidents write fallback to local storage:', e);
        }
      } else if (existingInc.daysOverdue !== daysOverdue && existingInc.status !== 'RESOLVED') {
        // Update days overdue and elevate severity if >= 3 days
        const updatedInc: ITILIncident = {
          ...existingInc,
          daysOverdue,
          severity: daysOverdue >= 3 ? 'CRITICAL' : existingInc.severity,
          updatedAt: new Date().toISOString(),
        };
        incidentsMap.set(updatedInc.id, updatedInc);
        hasChanges = true;
      }
    }
  }

  const updatedList = Array.from(incidentsMap.values());
  if (hasChanges) {
    saveLocalIncidents(updatedList);
  }
  return updatedList;
}

/**
 * FR-11: Quarantines defective inventory, updates stock, logs ITIL exception, and creates a supplier return ticket.
 */
export async function logDefectiveStockException(params: {
  productId: string;
  sku: string;
  productName: string;
  brand?: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  defectReason: DefectiveStockTicket['defectReason'];
  loggedBy: string;
  loggedByName: string;
  photoUrl?: string;
  supplierName?: string;
  notes?: string;
  inventory: InventoryItem[];
}): Promise<{ ticket: DefectiveStockTicket; incident: ITILIncident }> {
  const timestamp = new Date().toISOString();
  const ticketSuffix = Math.floor(1000 + Math.random() * 9000);
  const defTicketNumber = `DEF-2026-${ticketSuffix}`;
  const incTicketNumber = `INC-DEF-${ticketSuffix}`;

  const incidentId = `inc-def-${Date.now()}`;
  const ticketId = `ticket-def-${Date.now()}`;

  // 1. Create Defective Stock Ticket (for supplier return)
  const defectiveTicket: DefectiveStockTicket = {
    id: ticketId,
    ticketNumber: defTicketNumber,
    incidentId,
    productId: params.productId,
    sku: params.sku,
    productName: params.productName,
    brand: params.brand || 'N/A',
    warehouseId: params.warehouseId,
    warehouseName: params.warehouseName,
    quantity: params.quantity,
    defectReason: params.defectReason,
    loggedBy: params.loggedBy,
    loggedByName: params.loggedByName,
    photoUrl: params.photoUrl,
    supplierName: params.supplierName || 'Primary Supplier',
    status: 'QUARANTINED',
    createdAt: timestamp,
    resolutionNotes: params.notes,
  };

  // 2. Create matching ITIL Incident Ticket (FR-11)
  const incident: ITILIncident = {
    id: incidentId,
    ticketNumber: incTicketNumber,
    incidentType: 'DEFECTIVE_ASSET',
    severity: params.quantity > 5 ? 'HIGH' : 'MEDIUM',
    status: 'OPEN',
    delayedCIs: [
      {
        productId: params.productId,
        sku: params.sku,
        name: params.productName,
        quantity: params.quantity,
      },
    ],
    deliveryLocation: params.warehouseName,
    description: `Defective asset quarantined: ${params.quantity} unit(s) of ${params.productName} in ${params.warehouseName}. Reason: ${params.defectReason}. Supplier return ticket ${defTicketNumber} issued.`,
    rootCause: params.defectReason,
    resolutionNotes: params.notes,
    assignedAgentId: params.loggedBy,
    assignedAgentName: params.loggedByName,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // 3. Update local storage for incidents and tickets
  const currentIncidents = getLocalIncidents();
  saveLocalIncidents([incident, ...currentIncidents]);

  const currentTickets = getLocalDefectiveTickets();
  saveLocalDefectiveTickets([defectiveTicket, ...currentTickets]);

  // 4. Update warehouse stock: segregate from available quantity into quarantineQuantity
  const targetItem = params.inventory.find(
    (i) => i.productId === params.productId && i.warehouseId === params.warehouseId
  );

  if (targetItem) {
    const newQty = Math.max(0, targetItem.quantity - params.quantity);
    const newQuarantineQty = (targetItem.quarantineQuantity || 0) + params.quantity;

    try {
      const { error: rpcErr } = await supabase.rpc('adjust_inventory_atomic', {
        p_product_id: params.productId,
        p_warehouse_id: params.warehouseId,
        p_delta: -params.quantity,
        p_recorded_by: params.loggedBy,
        p_reason: `ITIL defective asset segregation to quarantine (${defTicketNumber})`
      });

      if (!rpcErr) {
        await updateDoc(doc(db, 'inventory', targetItem.id), {
          quarantineQuantity: newQuarantineQty,
          lastUpdated: serverTimestamp(),
        });
      } else {
        console.warn('adjust_inventory_atomic fallback in ITIL quarantine:', rpcErr);
        await updateDoc(doc(db, 'inventory', targetItem.id), {
          quantity: newQty,
          quarantineQuantity: newQuarantineQty,
          lastUpdated: serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn('Inventory quarantine update fallback to local:', e);
      // Update local storage representation of inventory
      try {
        const rawInv = localStorage.getItem('activepro_db_inventory');
        if (rawInv) {
          const invList: InventoryItem[] = JSON.parse(rawInv);
          const idx = invList.findIndex((i) => i.id === targetItem.id);
          if (idx >= 0) {
            invList[idx].quantity = newQty;
            invList[idx].quarantineQuantity = newQuarantineQty;
            localStorage.setItem('activepro_db_inventory', JSON.stringify(invList));
          }
        }
      } catch {}
    }
  }

  // 5. Log audit trail entry in stockAdjustments
  try {
    await addDoc(collection(db, 'stockAdjustments'), {
      productId: params.productId,
      warehouseId: params.warehouseId,
      adjustmentAmount: -params.quantity,
      reason: `Quarantine Exception [${defTicketNumber}]: ${params.defectReason} - ${params.notes || 'Segregated to quarantine'}`,
      recordedBy: params.loggedBy,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Audit trail write error:', e);
  }

  // 6. Push to remote database tables if available
  try {
    await setDoc(doc(db, 'itil_incidents', incident.id), incident);
    await setDoc(doc(db, 'defective_tickets', defectiveTicket.id), defectiveTicket);
  } catch (e) {
    console.warn('Remote sync error for ITIL tickets:', e);
  }

  return { ticket: defectiveTicket, incident };
}

/**
 * Resolves an active ITIL Incident with formal resolution notes.
 */
export async function resolveITILIncident(
  incidentId: string,
  resolutionNotes: string,
  resolvedByName: string
): Promise<ITILIncident | null> {
  const incidents = getLocalIncidents();
  const idx = incidents.findIndex((i) => i.id === incidentId);
  if (idx < 0) return null;

  const updated: ITILIncident = {
    ...incidents[idx],
    status: 'RESOLVED',
    resolutionNotes: `Resolved by ${resolvedByName}: ${resolutionNotes}`,
    resolvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  incidents[idx] = updated;
  saveLocalIncidents(incidents);

  try {
    await updateDoc(doc(db, 'itil_incidents', incidentId), {
      status: 'RESOLVED',
      resolutionNotes: updated.resolutionNotes,
      resolvedAt: updated.resolvedAt,
    });
  } catch {}

  return updated;
}

/**
 * Updates status of a Defective Stock Ticket (e.g., supplier replacement received or returned).
 */
export async function updateDefectiveTicketStatus(
  ticketId: string,
  newStatus: DefectiveStockTicket['status'],
  notes?: string
): Promise<DefectiveStockTicket | null> {
  const tickets = getLocalDefectiveTickets();
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx < 0) return null;

  const updated: DefectiveStockTicket = {
    ...tickets[idx],
    status: newStatus,
    resolutionNotes: notes ? `${tickets[idx].resolutionNotes || ''} | ${notes}` : tickets[idx].resolutionNotes,
  };

  tickets[idx] = updated;
  saveLocalDefectiveTickets(tickets);

  try {
    await updateDoc(doc(db, 'defective_tickets', ticketId), {
      status: newStatus,
      resolutionNotes: updated.resolutionNotes,
    });
  } catch {}

  return updated;
}

/**
 * Exports ITIL Incidents log to CSV.
 */
export function exportIncidentsCSV(incidents: ITILIncident[]) {
  const headers = [
    'Ticket Number',
    'Type',
    'Severity',
    'Status',
    'Order ID',
    'Client Name',
    'Location',
    'Days Overdue',
    'Created At',
    'Resolved At',
    'Description',
    'Resolution Notes',
  ];

  const rows = incidents.map((inc) => [
    `"${inc.ticketNumber || ''}"`,
    `"${inc.incidentType || ''}"`,
    `"${inc.severity || ''}"`,
    `"${inc.status || ''}"`,
    `"${inc.orderNumber || ''}"`,
    `"${(inc.clientName || '').replace(/"/g, '""')}"`,
    `"${inc.deliveryLocation || ''}"`,
    inc.daysOverdue ?? 0,
    `"${inc.createdAt || ''}"`,
    `"${inc.resolvedAt || ''}"`,
    `"${(inc.description || '').replace(/"/g, '""')}"`,
    `"${(inc.resolutionNotes || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `ITIL_Incident_Log_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Exports Defective Products Report for supplier returns to CSV.
 */
export function exportDefectiveProductsReportCSV(tickets: DefectiveStockTicket[]) {
  const headers = [
    'Return Ticket #',
    'SKU',
    'Product Name',
    'Brand',
    'Warehouse',
    'Defective Qty',
    'Defect Reason',
    'Supplier Name',
    'Logged By',
    'Date Logged',
    'Status',
    'Notes',
  ];

  const rows = tickets.map((t) => [
    `"${t.ticketNumber}"`,
    `"${t.sku}"`,
    `"${t.productName.replace(/"/g, '""')}"`,
    `"${t.brand || ''}"`,
    `"${t.warehouseName}"`,
    t.quantity,
    `"${t.defectReason}"`,
    `"${(t.supplierName || '').replace(/"/g, '""')}"`,
    `"${t.loggedByName}"`,
    `"${t.createdAt}"`,
    `"${t.status}"`,
    `"${(t.resolutionNotes || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Supplier_Defective_Products_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
