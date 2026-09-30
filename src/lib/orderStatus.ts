import type { Order, OrderStatus } from '../types';

const steps: OrderStatus[] = ['pending', 'preparing', 'out_for_delivery', 'delivered', 'completed'];

export function previousOrderStatus(order: Pick<Order, 'status' | 'statusHistory'>): OrderStatus | null {
  if (order.status === 'cancelled' || order.status === 'escalated') {
    return order.statusHistory?.slice().reverse().find(entry => steps.includes(entry.status))?.status ?? 'pending';
  }
  const index = steps.indexOf(order.status);
  return index > 0 ? steps[index - 1] : null;
}
