import type { InventoryItem } from '../types';

export type MovementType = 'external' | 'internal';
export interface MovementLine {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitCost: number;
}
export interface MovementDraft {
  type: MovementType;
  supplierId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  sourceZoneId?: string;
  destinationZoneId?: string;
  sourceZoneName?: string | null;
  destinationZoneName?: string | null;
  invoiceNumber: string;
  driverName: string;
  vehiclePlate: string;
  notes: string;
  items: MovementLine[];
}
export interface InventoryMovementRecord extends Omit<MovementDraft, 'supplierId' | 'sourceWarehouseId'> {
  supplierId: string | null;
  sourceWarehouseId: string | null;
  id: string;
  movementNumber: string;
  supplierName: string | null;
  sourceWarehouseName: string | null;
  destinationWarehouseName: string;
  totalValue: number | null;
  status: 'confirmed';
  recordedBy: string;
  recordedByName: string;
  createdAt: string;
  expenseId: string | null;
}
export const newMovementDraft = (): MovementDraft => ({
  type: 'external', supplierId: '', sourceWarehouseId: '', destinationWarehouseId: '',
  invoiceNumber: '', driverName: '', vehiclePlate: '', notes: '', items: [],
});
export const purchaseTotal = (items: MovementLine[]) =>
  items.reduce((total, item) => total + Math.round(item.unitCost * 100) * item.quantity, 0) / 100;
export const availableStock = (inventory: InventoryItem[], productId: string, warehouseId: string) =>
  inventory.filter(item => item.productId === productId && item.warehouseId === warehouseId)
    .reduce((total, item) => total + item.quantity, 0);

export function validateMovement(draft: MovementDraft, inventory: InventoryItem[]): string | null {
  if (!draft.destinationWarehouseId) return 'Select a receiving or destination warehouse.';
  if (draft.type === 'external' && !draft.supplierId) return 'Select a supplier.';
  if (draft.type === 'external' && !draft.invoiceNumber.trim()) return 'Enter the supplier invoice number.';
  if (draft.type === 'internal') {
    if (!draft.sourceWarehouseId) return 'Select a source warehouse.';
    if (draft.sourceWarehouseId === draft.destinationWarehouseId) return 'Source and destination must be different warehouses.';
  }
  if (!draft.items.length) return 'Add at least one product.';
  const demand = new Map<string, number>();
  for (const item of draft.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 2147483647)
      return `Enter a valid whole-number quantity for ${item.name}.`;
    if (draft.type === 'external' && (!Number.isFinite(item.unitCost) || item.unitCost <= 0 || item.unitCost > 9999999999.99))
      return `Enter a unit cost greater than zero for ${item.name}.`;
    if (draft.type === 'external' && Math.abs(item.unitCost * 100 - Math.round(item.unitCost * 100)) > 0.0001)
      return `Use no more than two decimal places for ${item.name}'s unit cost.`;
    demand.set(item.productId, (demand.get(item.productId) || 0) + item.quantity);
    if (draft.type === 'internal' && demand.get(item.productId)! > availableStock(inventory, item.productId, draft.sourceWarehouseId))
      return `Insufficient stock for ${item.name} in the source warehouse.`;
  }
  if (draft.type === 'external' && purchaseTotal(draft.items) > 9999999999.99) return 'Purchase total exceeds the supported amount.';
  return null;
}
