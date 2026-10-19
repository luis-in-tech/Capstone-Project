import type { InventoryItem } from '../types';

export interface WarehouseZone { id: string; warehouseId: string; name: string; sortOrder: number; }
export interface ZoneAllocation { id: string; zoneId: string; warehouseId: string; productId: string; quantity: number; }

export function warehouseQuantity(inventory: InventoryItem[], warehouseId: string, productId: string) {
  return inventory.filter(row => row.warehouseId === warehouseId && row.productId === productId)
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
}

export function zoneQuantity(allocations: ZoneAllocation[], inventory: InventoryItem[], warehouseId: string, productId: string, zoneId: string) {
  const rows = allocations.filter(row => row.warehouseId === warehouseId && row.productId === productId);
  return zoneId === 'unassigned'
    ? warehouseQuantity(inventory, warehouseId, productId) - rows.reduce((sum, row) => sum + Number(row.quantity), 0)
    : rows.filter(row => row.zoneId === zoneId).reduce((sum, row) => sum + Number(row.quantity), 0);
}
