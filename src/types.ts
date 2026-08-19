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
}

export interface Product {
  id: string;
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
  supplier?: string;
  photoUrl?: string;
  minStockLevel: number;
  reorderPoint: number;
  supplierMoq?: number;
  supplierId?: string;
  createdAt: any;
  updatedAt: any;
}

export interface Warehouse {
  id: string;
  name: string;
  location: string;
}

export interface InventoryItem {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  lastUpdated: any;
}

export type OrderStatus = 'pending' | 'preparing' | 'out_for_delivery' | 'delivered' | 'completed' | 'escalated';
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
  deliveryDeadline: any;
  photoValidationUrl?: string;
  statusHistory?: StatusHistoryEntry[];
  createdAt: any;
  updatedAt: any;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
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

export interface Transfer {
  id: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  productId: string;
  quantity: number;
  status: 'pending' | 'in_transit' | 'received';
  initiatedBy: string;
  createdAt: any;
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
