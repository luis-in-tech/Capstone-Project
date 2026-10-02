/**
 * @file logistics.types.ts
 * @description Type definitions for the Logistics Optimizer backend module.
 */

export interface LocationCoord {
  name: string;
  lat: number;
  lng: number;
}

export interface VehicleSpec {
  id: string;
  name: string;
  capacity: number; // max box/item capacity
  fixedCost: number; // Base dispatch cost in PHP
  costPerKm: number; // Fuel & transit wear cost per km in PHP
}

export interface OrderStopItem {
  id?: string;
  orderNumber?: string;
  clientName?: string;
  deliveryCity?: string;
  deliveryRegion?: string;
  status?: string;
  skus?: string[];
  totalAmount?: number;
}

export interface DeliveryStopDto {
  order: OrderStopItem;
  city: string;
  coord: LocationCoord;
  units: number;
}

export interface OptimizedRouteDto {
  routeId: string;
  region: string;
  vehicle: VehicleSpec;
  stops: DeliveryStopDto[];
  stopSequence: string[];
  totalUnits: number;
  capacityUtilizationPercent: number;
  routeDistanceKm: number;
  shippingCostPhp: number;
  baselineDistanceKm: number;
  baselineCostPhp: number;
  savingsPhp: number;
  distanceReductionPercent: number;
}

export interface OptimizationResultDto {
  routes: OptimizedRouteDto[];
  summary: {
    totalOrders: number;
    totalUnits: number;
    totalVehiclesDispatched: number;
    totalOptimizedDistanceKm: number;
    totalOptimizedCostPhp: number;
    totalBaselineCostPhp: number;
    totalSavingsPhp: number;
    overallDistanceReductionPercent: number;
    averageCapacityUtilizationPercent: number;
  };
}

export interface DispatchTripPayload {
  vehicleId?: string;
  vehicleName: string;
  plate: string;
  driver: string;
  region: string;
  routeId: string;
  totalUnits?: number;
  savingsPhp?: number;
  stops: Array<{
    orderId?: string;
    orderNumber?: string;
    clientName?: string;
    deliveryCity: string;
    units: number;
    stopSequence: number;
  }>;
  dispatchedBy: string;
}

export interface DispatchTripDto {
  id: string;
  vehicleId?: string;
  vehicleName: string;
  plate: string;
  driver: string;
  region: string;
  totalUnits: number;
  savingsPhp: number;
  status: 'in_transit' | 'completed' | 'cancelled';
  dispatchedAt: string;
  dispatchedBy: string;
  stops: Array<{
    id: string;
    orderId?: string;
    orderNumber?: string;
    clientName?: string;
    deliveryCity: string;
    units: number;
    stopSequence: number;
  }>;
}

export interface TrafficIncidentDto {
  id: string;
  type: 'accident' | 'closure' | 'congestion';
  corridor: string;
  delayMinutes: number;
  reporter: string;
  timestamp: string;
  bypassRoute: string;
  timeSavedMinutes: number;
  status: 'active' | 'rerouted';
}

export interface CreateTrafficIncidentPayload {
  type: 'accident' | 'closure' | 'congestion';
  corridor: string;
  delayMinutes: number;
  reporter: string;
  bypassRoute?: string;
  timeSavedMinutes?: number;
}

export interface StockRebalancePayload {
  productId: string;
  productName?: string;
  surplusWarehouseId: string;
  surplusWarehouseName?: string;
  depletedWarehouseId: string;
  depletedWarehouseName?: string;
  recommendedTransferQty: number;
  initiatedBy: string;
}
