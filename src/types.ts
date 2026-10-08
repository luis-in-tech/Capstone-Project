export type UserRole = 'admin' | 'secretary' | 'agent' | 'staff';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  role: UserRole;
  region?: string;
}

export interface StaffDelegation {
  id: string;
  agentId: string;
  staffEmail: string;
  canAdjustInventory: boolean;
  canAdjustPricelist: boolean;
  createdAt: any;
  active?: boolean;
  permissions?: StaffPermissions;
}

export type MovementAccess = 'both' | 'external' | 'internal' | 'none';
export type SupplyChainView = 'customers' | 'suppliers' | 'warehouses';
export interface StaffPermissions {
  inventory: 'view' | 'adjust';
  pricelist: 'view' | 'edit';
  orders: 'none' | 'view' | 'create';
  movementView: MovementAccess;
  movementCreate: MovementAccess;
  supplyChain: SupplyChainView[] | 'all' | SupplyChainView | 'none';
  warehouseAccess: 'all' | 'selected';
  warehouseIds: string[];
}

export interface Product {
  id: string;
  hasVariations?: boolean;
  variationAttributes?: VariationAttribute[];
  parentProductId?: string | null;
  variantValues?: Record<string, string>;
  variantEnabled?: boolean;
  sku: string;
  name: string;
  category: string;
  description?: string;
  basePrice: number;
  wholesalePrice?: number;
  dealerPrice?: number;
  mmPrice?: number;
  provincialPrice?: number;
  costPrice?: number;
  promoPrice?: number;
  supplier?: string;
  photoUrl?: string;
  minStockLevel: number;
  reorderPoint: number;
  supplierMoq?: number;
  supplierId?: string;
  locationAisle?: string;
  locationBin?: string;
  createdAt: any;
  updatedAt: any;
}

export interface VariationAttribute {
  name: string;
  values: string[];
}

export interface Warehouse {
  id: string;
  name: string;
  location: string;
  active?: boolean;
}

export interface InventoryItem {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  quarantineQuantity?: number;
  lastUpdated: any;
}

export type OrderStatus = 'pending' | 'preparing' | 'out_for_delivery' | 'delivered' | 'completed' | 'escalated' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'defaulted';

export interface StatusHistoryEntry {
  status: OrderStatus;
  changedBy: string;
  timestamp: any;
  note?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  agentId: string;
  clientId: string;
  clientName: string;
  status: OrderStatus;
  skus?: string[];
  totalAmount: number;
  paymentStatus: PaymentStatus;
  deliveryRegion: string;
  deliveryCity?: string;
  deliveryDeadline: any;
  photoValidationUrl?: string;
  statusHistory?: StatusHistoryEntry[];
  allocationStrategy?: 'FIFO' | 'LIFO';
  allocatedBatches?: Array<{
    productId: string;
    batchCode: string;
    quantity: number;
    receivedDate?: string;
  }>;
  createdAt: any;
  updatedAt: any;
}

export type IncidentType = 'SLA_BREACH' | 'DEFECTIVE_ASSET' | 'DISPATCH_DELAY' | 'STOCK_DISCREPANCY';
export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

export interface ITILIncident {
  id: string;
  ticketNumber: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  orderId?: string;
  orderNumber?: string;
  clientId?: string;
  clientName?: string;
  deliveryLocation?: string;
  delayedCIs?: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
  }>;
  daysOverdue?: number;
  assignedAgentId?: string;
  assignedAgentName?: string;
  description: string;
  rootCause?: string;
  resolutionNotes?: string;
  createdAt: any;
  updatedAt?: any;
  resolvedAt?: any;
}

export interface DefectiveStockTicket {
  id: string;
  ticketNumber: string;
  incidentId?: string;
  productId: string;
  sku: string;
  productName: string;
  brand?: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  defectReason: 'Damaged in Transit' | 'Manufacturer Defect' | 'Handling Damage' | 'Missing Parts' | 'Expired / Degraded';
  loggedBy: string;
  loggedByName: string;
  photoUrl?: string;
  supplierName?: string;
  status: 'QUARANTINED' | 'RETURN_IN_PROGRESS' | 'REPLACED' | 'WRITTEN_OFF';
  createdAt: any;
  resolutionNotes?: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  warehouseId?: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  locationAisle?: string;
  locationBin?: string;
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: any;
  recordedBy: string;
  orderId?: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: any;
}

export type TransferStatus = 'pending' | 'in_transit' | 'received' | 'cancelled';

export interface Transfer {
  id: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  productId: string;
  quantity: number;
  status: TransferStatus;
  initiatedBy: string;
  driverName?: string;
  vehiclePlate?: string;
  dispatchedAt?: any;
  dispatchedBy?: string;
  receivedAt?: any;
  receivedBy?: string;
  cancelledAt?: any;
  cancelledBy?: string;
  cancellationReason?: string;
  createdAt: any;
  updatedAt?: any;
}

export interface StockAdjustment {
  id: string;
  productId: string;
  warehouseId: string;
  adjustmentAmount: number;
  reason: string;
  recordedBy: string;
  timestamp: any;
}
