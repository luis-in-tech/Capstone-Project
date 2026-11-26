import type { Order, OrderStatus } from '../types';

const steps: OrderStatus[] = ['pending', 'preparing', 'out_for_delivery', 'delivered', 'completed'];

export function previousOrderStatus(order: Pick<Order, 'status' | 'statusHistory'>): OrderStatus | null {
  if (order.status === 'cancelled' || order.status === 'escalated') {
    return order.statusHistory?.slice().reverse().find(entry => steps.includes(entry.status))?.status ?? 'pending';
  }
  const index = steps.indexOf(order.status);
  return index > 0 ? steps[index - 1] : null;
}

export function requiresStockReReservation(fromStatus: OrderStatus, toStatus: OrderStatus): boolean {
  return (fromStatus === 'cancelled' || fromStatus === 'escalated') && steps.includes(toStatus);
}

export function revertBlockReason(
  order: Pick<Order, 'status' | 'photoValidationUrl'>,
  target: OrderStatus | null,
): string | null {
  if (!target) return 'This order cannot be reverted further.';
  if (target === 'out_for_delivery' && !order.photoValidationUrl) {
    return 'Cannot revert directly to "out for delivery" without a dispatch validation photo.';
  }
  return null;
}
