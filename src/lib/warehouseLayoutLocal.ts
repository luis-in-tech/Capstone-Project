import type { InventoryItem } from '../types';
import { warehouseQuantity, type WarehouseZone, type ZoneAllocation } from './warehouseLayout';

export interface LocalLayout { zones: WarehouseZone[]; allocations: ZoneAllocation[]; }
export const localLayoutKey = (project: string, user: string, warehouse: string) =>
  `activepro:warehouse-layout:v1:${encodeURIComponent(project)}:${encodeURIComponent(user)}:${warehouse}`;

export function readLocalLayout(storage: Pick<Storage, 'getItem'>, key: string, warehouseId: string): LocalLayout {
  const raw = storage.getItem(key);
  if (!raw) return { zones: [], allocations: [] };
  const data = JSON.parse(raw) as LocalLayout;
  if (!Array.isArray(data.zones) || !Array.isArray(data.allocations)) throw new Error('The saved temporary layout is unreadable. Your browser data has not been overwritten.');
  const zones = data.zones.filter(z => z && z.warehouseId === warehouseId && typeof z.id === 'string' && typeof z.name === 'string' && Number.isInteger(z.sortOrder));
  const allocations = data.allocations.filter(a => a && a.warehouseId === warehouseId && zones.some(z => z.id === a.zoneId) && typeof a.productId === 'string' && Number.isSafeInteger(a.quantity) && a.quantity > 0);
  return { zones: zones.sort((a, b) => a.sortOrder - b.sortOrder), allocations };
}

// A local preview cannot know which zone a real stock deduction came from.
// Exclude conflicting allocations instead of inventing a zone deduction.
export function validLocalAllocations(layout: LocalLayout, inventory: InventoryItem[], warehouseId: string) {
  const totals = new Map<string, number>();
  layout.allocations.forEach(a => totals.set(a.productId, (totals.get(a.productId) || 0) + a.quantity));
  return layout.allocations.filter(a => (totals.get(a.productId) || 0) <= warehouseQuantity(inventory, warehouseId, a.productId));
}

export function assignLocalQuantity(layout: LocalLayout, inventory: InventoryItem[], warehouseId: string, zoneId: string, productId: string, quantity: number): LocalLayout {
  if (!layout.zones.some(z => z.id === zoneId && z.warehouseId === warehouseId)) throw new Error('Zone no longer exists. Refresh the layout.');
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Enter a non-negative whole quantity.');
  const others = layout.allocations.filter(a => a.zoneId !== zoneId || a.productId !== productId);
  const available = warehouseQuantity(inventory, warehouseId, productId) - others.filter(a => a.productId === productId).reduce((sum, a) => sum + a.quantity, 0);
  if (quantity > Math.max(0, available)) throw new Error(`Not enough Unassigned stock. At most ${Math.max(0, available)} units can be recorded in this zone.`);
  return { ...layout, allocations: quantity === 0 ? others : [...others, { id: `${zoneId}:${productId}`, warehouseId, zoneId, productId, quantity }] };
}
