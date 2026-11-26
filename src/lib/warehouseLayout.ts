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

function warehousePriority(name: string): number {
  const n = name.trim();
  if (/main.*manila|manila.*main/i.test(n)) return 0;
  if (/main warehouse/i.test(n)) return 1;
  if (/\bmanila\b/i.test(n)) return 2;
  if (/\bmain\b/i.test(n)) return 3;
  return 4;
}

export function sortWarehousesForLayout<T extends { id: string; name: string }>(warehouses: T[]): T[] {
  return [...warehouses].sort((a, b) => {
    const rankDiff = warehousePriority(a.name) - warehousePriority(b.name);
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name);
  });
}

export function pickDefaultWarehouse<T extends { id: string; name: string }>(warehouses: T[]): T | undefined {
  return sortWarehousesForLayout(warehouses)[0];
}

export function defaultZoneBox(index: number, totalZones = 6) {
  const count = Math.max(1, totalZones, index + 1);
  if (count <= 6) {
    return {
      x: 8 + (index % 2) * 44,
      y: 8 + Math.floor(index / 2) * 27,
      w: 40,
      h: 24,
      color: index % 4,
    };
  }
  const cols = count <= 12 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const w = cols === 3 ? 28 : 21;
  const x = cols === 3 ? 5 + (index % 3) * 31 : 4 + (index % 4) * 23.5;
  const stepY = Math.floor(86 / rows);
  const h = Math.max(6, Math.min(22, stepY - 3));
  const y = 7 + Math.floor(index / cols) * stepY;
  return { x, y, w, h, color: index % 4 };
}
