import type { Order } from '../types';
import type { InventoryMovementRecord } from './inventoryMovement';

export interface BatchAllocation {
  batchId: string;
  batchCode: string;
  receivedDate: string;
  allocatedQty: number;
  unitCost: number;
  warehouseName?: string;
}

export interface AllocationResult {
  allocations: BatchAllocation[];
  fulfilledQty: number;
  remainingUnfulfilled: number;
  strategy: 'FIFO' | 'LIFO';
}

export interface AvailableBatch {
  batchId: string;
  batchCode: string;
  productId: string;
  sku: string;
  name: string;
  warehouseId?: string;
  warehouseName: string;
  receivedDate: string;
  quantity: number;
  unitCost: number;
}

function toTimeMs(value: any): number {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') {
    const t = value.toDate().getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toIsoString(value: any): string {
  if (!value) return '';
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  const str = String(value);
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? str : parsed.toISOString();
}

/**
 * Extracts all received batches from external supplier inventory movements.
 */
export function extractBatchesFromMovements(movements: InventoryMovementRecord[]): AvailableBatch[] {
  const batches: AvailableBatch[] = [];

  for (const movement of movements) {
    if (movement.type !== 'external' || !Array.isArray(movement.items)) continue;

    for (let idx = 0; idx < movement.items.length; idx++) {
      const item = movement.items[idx];
      if (!item.productId || item.quantity <= 0) continue;

      const receivedDate = toIsoString(item.receivedDate || movement.createdAt) || new Date().toISOString();
      batches.push({
        batchId: item.batchId || `${movement.id}-${item.productId}-${idx}`,
        batchCode: item.batchCode || `LOT-${item.sku || 'CI'}-${receivedDate.slice(0, 10)}`,
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        warehouseId: movement.destinationWarehouseId,
        warehouseName: movement.destinationWarehouseName,
        receivedDate,
        quantity: item.quantity,
        unitCost: item.unitCost || 0,
      });
    }
  }

  return batches;
}

/**
 * Algorithmic FIFO / LIFO Batch Allocator (FR-09)
 * Allocates requested item quantities across batches based on arrival sequence.
 * - FIFO: Oldest stock received is depleted first (ITIL 4 asset lifecycle compliance).
 * - LIFO: Newest stock received is depleted first.
 */
export function allocateBatchesByStrategy(
  batches: AvailableBatch[],
  productId: string,
  requestedQty: number,
  strategy: 'FIFO' | 'LIFO' = 'FIFO',
  warehouseId?: string
): AllocationResult {
  if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
    return { allocations: [], fulfilledQty: 0, remainingUnfulfilled: 0, strategy };
  }

  // Filter matching product and warehouse (if specified)
  const candidateBatches = batches.filter(
    (b) => b.productId === productId && (!warehouseId || b.warehouseId === warehouseId)
  );

  // Sort batches by arrival timestamp
  const sortedBatches = [...candidateBatches].sort((a, b) => {
    const timeA = toTimeMs(a.receivedDate);
    const timeB = toTimeMs(b.receivedDate);
    return strategy === 'FIFO' ? timeA - timeB : timeB - timeA;
  });

  const allocations: BatchAllocation[] = [];
  let remainingNeeded = requestedQty;

  for (const batch of sortedBatches) {
    if (remainingNeeded <= 0) break;

    const allocatable = Math.min(batch.quantity, remainingNeeded);
    if (allocatable > 0) {
      allocations.push({
        batchId: batch.batchId,
        batchCode: batch.batchCode,
        receivedDate: batch.receivedDate,
        allocatedQty: allocatable,
        unitCost: batch.unitCost,
        warehouseName: batch.warehouseName,
      });
      remainingNeeded -= allocatable;
    }
  }

  return {
    allocations,
    fulfilledQty: requestedQty - remainingNeeded,
    remainingUnfulfilled: Math.max(0, remainingNeeded),
    strategy,
  };
}

/**
 * Prioritizes order queue based on SLA urgency and FIFO arrival sequence (FR-09).
 */
export function prioritizeOrderQueue(orders: Order[], strategy: 'FIFO' | 'LIFO' = 'FIFO'): Order[] {
  const activeOrders = orders.filter((o) => !['delivered', 'completed', 'cancelled'].includes(o.status));
  const now = Date.now();

  return [...activeOrders].sort((a, b) => {
    const rawDeadlineA = a.deliveryDeadline ? toTimeMs(a.deliveryDeadline) : 0;
    const rawDeadlineB = b.deliveryDeadline ? toTimeMs(b.deliveryDeadline) : 0;
    const deadlineA = rawDeadlineA > 0 ? rawDeadlineA : Infinity;
    const deadlineB = rawDeadlineB > 0 ? rawDeadlineB : Infinity;
    const isOverdueA = deadlineA < now;
    const isOverdueB = deadlineB < now;

    // Overdue/breached orders always have highest urgency
    if (isOverdueA && !isOverdueB) return -1;
    if (!isOverdueA && isOverdueB) return 1;

    // Next, sort by deadline proximity
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;

    // Tie-breaker: FIFO (earliest created first) vs LIFO
    const createdA = toTimeMs(a.createdAt);
    const createdB = toTimeMs(b.createdAt);
    return strategy === 'FIFO' ? createdA - createdB : createdB - createdA;
  });
}
