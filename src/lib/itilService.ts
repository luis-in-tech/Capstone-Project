import { db } from './supabaseAdapter';
import { collection, getDoc, getDocs, updateDoc, setDoc, deleteDoc, addDoc, doc, serverTimestamp } from './supabaseAdapter';
import { getRegionalSlaDays } from '../constants/deliveryLocations';
import type { Order, ITILIncident, DefectiveStockTicket, UserProfile, InventoryItem } from '../types';
import { escapeCsvCell } from './exportUtils';

const ITIL_INCIDENTS_STORAGE_KEY = 'activepro_db_itil_incidents';
const DEFECTIVE_TICKETS_STORAGE_KEY = 'activepro_db_defective_tickets';
const SLA_SYNC_CACHE_TTL_MS = 30_000;

let inFlightSlaSync: Promise<ITILIncident[]> | null = null;
let lastSlaSignature = '';
let lastSlaSyncAt = 0;
let lastSlaResult: ITILIncident[] | null = null;

function buildOrdersSlaSignature(orders: Order[]): string {
  return orders
    .map((o) => `${o.id}:${o.status}:${String(o.deliveryDeadline ?? '')}:${String(o.createdAt ?? '')}:${o.deliveryRegion ?? ''}`)
    .join('|');
}

export function getLocalIncidents(): ITILIncident[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(ITIL_INCIDENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalIncidents(incidents: ITILIncident[]) {
  lastSlaResult = incidents;
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
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const ms = (value as { toDate: () => Date }).toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = new Date(value as string | number | Date).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * FR-06: Evaluates active orders and auto-generates ITIL Incident tickets for SLA breaches.
 * Baseline: 7 days for Metro Manila, 10 days for Luzon, 14 days for Visayas / Mindanao.
 */
export async function evaluateAndSyncSLAIncidents(
  orders: Order[],
  currentUser?: UserProfile | null
): Promise<ITILIncident[]> {
  const signature = buildOrdersSlaSignature(orders);
  const nowTs = Date.now();
  if (lastSlaResult && signature === lastSlaSignature && nowTs - lastSlaSyncAt < SLA_SYNC_CACHE_TTL_MS) {
    return lastSlaResult;
  }
  if (inFlightSlaSync && signature === lastSlaSignature) {
    return inFlightSlaSync;
  }

  lastSlaSignature = signature;
  inFlightSlaSync = (async () => {
    const localIncidents = getLocalIncidents();
    let hasRemoteMerge = false;
    const incidentsMap = new Map<string, ITILIncident>(localIncidents.map((inc) => [inc.id, inc]));

    try {
      const remoteSnap = await getDocs(collection(db, 'itil_incidents'));
      if (remoteSnap && Array.isArray(remoteSnap.docs)) {
        for (const d of remoteSnap.docs) {
          const remoteInc: ITILIncident = { ...(d.data() as ITILIncident), id: d.id };
          const existingLocal = incidentsMap.get(remoteInc.id);
          if (!existingLocal || String(remoteInc.updatedAt || '') >= String(existingLocal.updatedAt || '')) {
            incidentsMap.set(remoteInc.id, remoteInc);
            hasRemoteMerge = true;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch remote ITIL incidents; using local cache:', e);
    }

    const orderIncidentMap = new Map<string, ITILIncident>();

    for (const inc of incidentsMap.values()) {
      if (inc.orderId && inc.incidentType === 'SLA_BREACH') {
        orderIncidentMap.set(inc.orderId, inc);
      }
    }

    const now = Date.now();
    let hasChanges = hasRemoteMerge;
    const syncTasks: Promise<void>[] = [];

    for (const order of orders) {
      // Only check active orders
      if (['delivered', 'completed', 'cancelled'].includes(order.status)) {
        // If order was resolved/completed, auto-resolve any open SLA incident
        const existingInc = orderIncidentMap.get(order.id);
        if (existingInc && existingInc.status !== 'RESOLVED' && existingInc.status !== 'CLOSED') {
          const nowIso = new Date().toISOString();
          const resolvedInc: ITILIncident = {
            ...existingInc,
            status: 'RESOLVED',
            resolvedAt: nowIso,
            updatedAt: nowIso,
            resolutionNotes: `Auto-resolved upon order fulfillment (${order.status}).`,
          };
          incidentsMap.set(resolvedInc.id, resolvedInc);
          hasChanges = true;
          syncTasks.push(
            updateDoc(doc(db, 'itil_incidents', resolvedInc.id), {
              status: 'RESOLVED',
              resolvedAt: resolvedInc.resolvedAt,
              updatedAt: resolvedInc.updatedAt,
              resolutionNotes: resolvedInc.resolutionNotes,
            }).catch((e) => {
              console.warn('Failed to sync auto-resolved ITIL incident to Supabase:', e);
            }),
          );
        }
        continue;
      }

      // Determine deadline
      let deadlineMs = toMillis(order.deliveryDeadline);
      if (deadlineMs === null) {
        const createdMs = toMillis(order.createdAt);
        if (createdMs === null) continue;
        const slaDays = getRegionalSlaDays(order.deliveryRegion);
        deadlineMs = createdMs + slaDays * 24 * 60 * 60 * 1000;
      }

      if (now > deadlineMs) {
        const daysOverdue = Math.max(1, Math.floor((now - deadlineMs) / (24 * 60 * 60 * 1000)));
        const existingInc = orderIncidentMap.get(order.id);

        if (!existingInc) {
          // Auto-generate brand new ITIL incident record (FR-06)
          const safeOrderNum = String(order.orderNumber || order.id || 'UNKNOWN').trim();
          const newTicketNumber = `INC-SLA-${safeOrderNum.replace(/[^A-Za-z0-9]/g, '') || order.id}`;
          const newIncident: ITILIncident = {
            id: `inc-sla-${order.id}`,
            ticketNumber: newTicketNumber,
            incidentType: 'SLA_BREACH',
            severity: daysOverdue >= 3 ? 'CRITICAL' : 'HIGH',
            status: 'ESCALATED',
            orderId: order.id,
            orderNumber: safeOrderNum,
            clientId: order.clientId,
            clientName: order.clientName,
            deliveryLocation: order.deliveryRegion || 'Unspecified',
            daysOverdue,
            assignedAgentId: order.agentId,
            assignedAgentName: (order as any).agentName || (order as any).preparedBy || (currentUser?.uid === order.agentId ? currentUser?.displayName : undefined) || 'Assigned Field Agent',
            description: `ITIL SLA Breach: Fulfillment target exceeded for ${order.deliveryRegion || 'destination'}. Order is ${daysOverdue} day(s) overdue.`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          incidentsMap.set(newIncident.id, newIncident);
          orderIncidentMap.set(order.id, newIncident);
          hasChanges = true;

          // Push to Supabase itil_incidents concurrently
          syncTasks.push(
            setDoc(doc(db, 'itil_incidents', newIncident.id), newIncident).catch((e) => {
              console.warn('Supabase itil_incidents write fallback to local storage:', e);
            }),
          );
        } else if (existingInc.daysOverdue !== daysOverdue && existingInc.status !== 'RESOLVED' && existingInc.status !== 'CLOSED') {
          // Update days overdue and elevate severity if >= 3 days
          const updatedAt = new Date().toISOString();
          const updatedInc: ITILIncident = {
            ...existingInc,
            daysOverdue,
            severity: daysOverdue >= 3 ? 'CRITICAL' : existingInc.severity,
            updatedAt,
          };
          incidentsMap.set(updatedInc.id, updatedInc);
          hasChanges = true;
          syncTasks.push(
            updateDoc(doc(db, 'itil_incidents', updatedInc.id), {
              daysOverdue: updatedInc.daysOverdue,
              severity: updatedInc.severity,
              updatedAt,
            }).catch((e) => {
              console.warn('Failed to sync escalated ITIL incident to Supabase:', e);
            }),
          );
        }
      }
    }

    if (syncTasks.length > 0) {
      await Promise.allSettled(syncTasks);
    }

    const updatedList = Array.from(incidentsMap.values());
    if (hasChanges) {
      saveLocalIncidents(updatedList);
    }
    lastSlaResult = updatedList;
    lastSlaSyncAt = Date.now();
    return updatedList;
  })();

  try {
    return await inFlightSlaSync;
  } finally {
    inFlightSlaSync = null;
  }
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
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw new Error('Quarantine quantity must be a positive whole number.');
  }

  // 0. Validate stock availability across all matching inventory batches in origin warehouse
  const candidateRows = params.inventory.filter(
    (i) => i.productId === params.productId && i.warehouseId === params.warehouseId && i.id
  );
  if (candidateRows.length === 0) {
    throw new Error(
      `Cannot quarantine ${params.quantity} unit(s) of ${params.productName}. No inventory record found in ${params.warehouseName}.`
    );
  }

  const liveRows = await Promise.all(
    candidateRows.map(async (row) => {
      const freshSnap = await getDoc(doc(db, 'inventory', row.id)).catch(() => null);
      if (freshSnap?.exists()) {
        return { ...row, ...(freshSnap.data() as InventoryItem) };
      }
      return row;
    })
  );
  const availableQty = liveRows.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)), 0);
  if (availableQty < params.quantity) {
    throw new Error(
      `Cannot quarantine ${params.quantity} unit(s) of ${params.productName}. Only ${availableQty} available in ${params.warehouseName}.`
    );
  }

  const timestamp = new Date().toISOString();
  const uuid = crypto.randomUUID();
  const ticketSuffix = uuid.slice(0, 8).toUpperCase();
  const defTicketNumber = `DEF-${new Date().getFullYear()}-${ticketSuffix}`;
  const incTicketNumber = `INC-DEF-${ticketSuffix}`;

  const incidentId = `inc-def-${uuid}`;
  const ticketId = `ticket-def-${uuid}`;

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

  // 3. Persist inventory quarantine shift and related records atomically
  const updatedInventoryRows: { id: string; prevQty: number; prevQuarantineQty: number }[] = [];
  let createdAdjustmentId: string | null = null;
  let incidentCreated = false;
  let ticketCreated = false;

  try {
    let remainingToQuarantine = params.quantity;
    for (const row of liveRows) {
      if (remainingToQuarantine <= 0) break;
      const rowAvail = Math.max(0, Number(row.quantity || 0));
      if (rowAvail <= 0) continue;
      const take = Math.min(rowAvail, remainingToQuarantine);
      const prevQty = Number(row.quantity || 0);
      const prevQuarantineQty = Number(row.quarantineQuantity || 0);
      await updateDoc(doc(db, 'inventory', row.id), {
        quantity: prevQty - take,
        quarantineQuantity: prevQuarantineQty + take,
        lastUpdated: serverTimestamp(),
      });
      updatedInventoryRows.push({ id: row.id, prevQty, prevQuarantineQty });
      remainingToQuarantine -= take;
    }

    const adjRef = await addDoc(collection(db, 'stockAdjustments'), {
      productId: params.productId,
      warehouseId: params.warehouseId,
      adjustmentAmount: -params.quantity,
      reason: `Quarantine Exception [${defTicketNumber}]: ${params.defectReason} - ${params.notes || 'Segregated to quarantine'}`,
      recordedBy: params.loggedBy,
      timestamp: serverTimestamp(),
    });
    createdAdjustmentId = adjRef?.id || null;

    await setDoc(doc(db, 'itil_incidents', incident.id), incident);
    incidentCreated = true;

    await setDoc(doc(db, 'defective_tickets', defectiveTicket.id), defectiveTicket);
    ticketCreated = true;
  } catch (err) {
    if (ticketCreated) {
      await deleteDoc(doc(db, 'defective_tickets', defectiveTicket.id)).catch(() => {});
    }
    if (incidentCreated) {
      await deleteDoc(doc(db, 'itil_incidents', incident.id)).catch(() => {});
    }
    if (createdAdjustmentId) {
      await deleteDoc(doc(db, 'stockAdjustments', createdAdjustmentId)).catch(() => {});
    }
    for (const prev of updatedInventoryRows) {
      await updateDoc(doc(db, 'inventory', prev.id), {
        quantity: prev.prevQty,
        quarantineQuantity: prev.prevQuarantineQty,
        lastUpdated: serverTimestamp(),
      }).catch(() => {});
    }
    throw err;
  }

  // 4. Sync local caches after confirmed persistence
  const currentIncidents = getLocalIncidents();
  saveLocalIncidents([incident, ...currentIncidents]);

  const currentTickets = getLocalDefectiveTickets();
  saveLocalDefectiveTickets([defectiveTicket, ...currentTickets]);

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
  const incidentsBefore = getLocalIncidents();
  let idx = incidentsBefore.findIndex((i) => i.id === incidentId);
  let targetIncident: ITILIncident | undefined = idx >= 0 ? incidentsBefore[idx] : undefined;

  if (!targetIncident) {
    const remoteSnap = await getDoc(doc(db, 'itil_incidents', incidentId)).catch(() => null);
    if (remoteSnap?.exists()) {
      targetIncident = { ...(remoteSnap.data() as ITILIncident), id: incidentId };
    }
  }
  if (!targetIncident) return null;

  const nowIso = new Date().toISOString();
  const updated: ITILIncident = {
    ...targetIncident,
    status: 'RESOLVED',
    resolutionNotes: `Resolved by ${resolvedByName}: ${resolutionNotes}`,
    resolvedAt: nowIso,
    updatedAt: nowIso,
  };

  const nextIncidents = idx >= 0
    ? incidentsBefore.map((item, i) => (i === idx ? updated : item))
    : [updated, ...incidentsBefore];
  saveLocalIncidents(nextIncidents);

  try {
    await updateDoc(doc(db, 'itil_incidents', incidentId), {
      status: 'RESOLVED',
      resolutionNotes: updated.resolutionNotes,
      resolvedAt: updated.resolvedAt,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    saveLocalIncidents(incidentsBefore);
    throw err;
  }

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
  const ticketsBefore = getLocalDefectiveTickets();
  let idx = ticketsBefore.findIndex((t) => t.id === ticketId);
  let targetTicket: DefectiveStockTicket | undefined = idx >= 0 ? ticketsBefore[idx] : undefined;

  if (!targetTicket) {
    const remoteSnap = await getDoc(doc(db, 'defective_tickets', ticketId)).catch(() => null);
    if (remoteSnap?.exists()) {
      targetTicket = { ...(remoteSnap.data() as DefectiveStockTicket), id: ticketId };
    }
  }
  if (!targetTicket) return null;

  const nowIso = new Date().toISOString();
  const prevNotes = targetTicket.resolutionNotes;
  const mergedNotes = notes ? (prevNotes ? `${prevNotes} | ${notes}` : notes) : prevNotes;

  const updated: DefectiveStockTicket = {
    ...targetTicket,
    status: newStatus,
    resolutionNotes: mergedNotes,
  };

  const nextTickets = idx >= 0
    ? ticketsBefore.map((item, i) => (i === idx ? updated : item))
    : [updated, ...ticketsBefore];
  saveLocalDefectiveTickets(nextTickets);

  const incidentsBefore = getLocalIncidents();
  let nextIncidents: ITILIncident[] | null = null;
  let linkedIncidentUpdate: {
    id: string;
    status: ITILIncident['status'];
    updatedAt: string;
    resolvedAt?: string;
    resolutionNotes?: string;
  } | null = null;

  if (updated.incidentId) {
    let incIdx = incidentsBefore.findIndex((inc) => inc.id === updated.incidentId);
    let targetInc: ITILIncident | undefined = incIdx >= 0 ? incidentsBefore[incIdx] : undefined;
    if (!targetInc) {
      const incSnap = await getDoc(doc(db, 'itil_incidents', updated.incidentId)).catch(() => null);
      if (incSnap?.exists()) {
        targetInc = { ...(incSnap.data() as ITILIncident), id: updated.incidentId };
      }
    }
    if (targetInc) {
      const mappedStatus: ITILIncident['status'] =
        newStatus === 'REPLACED' || newStatus === 'WRITTEN_OFF'
          ? 'RESOLVED'
          : newStatus === 'RETURN_IN_PROGRESS'
            ? 'INVESTIGATING'
            : 'OPEN';
      const resolvedAt = mappedStatus === 'RESOLVED' ? nowIso : targetInc.resolvedAt;
      const resolutionNotes =
        mappedStatus === 'RESOLVED'
          ? `Defective stock ticket ${updated.ticketNumber} finalized (${newStatus.replace('_', ' ')}).`
          : targetInc.resolutionNotes;
      const updatedInc: ITILIncident = {
        ...targetInc,
        status: mappedStatus,
        updatedAt: nowIso,
        resolvedAt,
        resolutionNotes,
      };
      nextIncidents = incIdx >= 0
        ? incidentsBefore.map((item, i) => (i === incIdx ? updatedInc : item))
        : [updatedInc, ...incidentsBefore];
      linkedIncidentUpdate = {
        id: updated.incidentId,
        status: mappedStatus,
        updatedAt: nowIso,
        ...(resolvedAt ? { resolvedAt } : {}),
        ...(resolutionNotes ? { resolutionNotes } : {}),
      };
      saveLocalIncidents(nextIncidents);
    }
  }

  try {
    await updateDoc(doc(db, 'defective_tickets', ticketId), {
      status: newStatus,
      resolutionNotes: updated.resolutionNotes,
      updatedAt: nowIso,
    });
    if (linkedIncidentUpdate) {
      await updateDoc(doc(db, 'itil_incidents', linkedIncidentUpdate.id), {
        status: linkedIncidentUpdate.status,
        updatedAt: linkedIncidentUpdate.updatedAt,
        ...(linkedIncidentUpdate.resolvedAt ? { resolvedAt: linkedIncidentUpdate.resolvedAt } : {}),
        ...(linkedIncidentUpdate.resolutionNotes ? { resolutionNotes: linkedIncidentUpdate.resolutionNotes } : {}),
      });
    }
  } catch (err) {
    saveLocalDefectiveTickets(ticketsBefore);
    if (nextIncidents) {
      saveLocalIncidents(incidentsBefore);
    }
    throw err;
  }

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
  ].map(escapeCsvCell);

  const rows = incidents.map((inc) =>
    [
      inc.ticketNumber || '',
      inc.incidentType || '',
      inc.severity || '',
      inc.status || '',
      inc.orderNumber || '',
      inc.clientName || '',
      inc.deliveryLocation || '',
      inc.daysOverdue ?? 0,
      inc.createdAt || '',
      inc.resolvedAt || '',
      inc.description || '',
      inc.resolutionNotes || '',
    ].map(escapeCsvCell)
  );

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `ITIL_Incident_Log_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  ].map(escapeCsvCell);

  const rows = tickets.map((t) =>
    [
      t.ticketNumber,
      t.sku,
      t.productName,
      t.brand || '',
      t.warehouseName,
      t.quantity,
      t.defectReason,
      t.supplierName || '',
      t.loggedByName,
      t.createdAt,
      t.status,
      t.resolutionNotes || '',
    ].map(escapeCsvCell)
  );

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Supplier_Defective_Products_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
