/**
 * @file logistics.service.ts
 * @description
 *   Core server-side Logistics Optimizer service.
 *   Implements Clarke-Wright Savings heuristic + 2-Opt sequence refinement,
 *   dispatch trip management, and live traffic incident bypasses.
 */

import { AppError } from '../middleware/errorHandler';
import {
  LocationCoord,
  VehicleSpec,
  OrderStopItem,
  DeliveryStopDto,
  OptimizedRouteDto,
  OptimizationResultDto,
  DispatchTripPayload,
  DispatchTripDto,
  TrafficIncidentDto,
  CreateTrafficIncidentPayload,
  StockRebalancePayload,
} from '../types/logistics.types';
import * as transfersService from './transfers.service';

export const DEFAULT_DEPOT: LocationCoord = {
  name: 'Valenzuela Central Logistics Hub',
  lat: 14.7011,
  lng: 120.983,
};

export const STANDARD_FLEET: VehicleSpec[] = [
  {
    id: 'van',
    name: 'L300 Urban Van',
    capacity: 40,
    fixedCost: 850,
    costPerKm: 28,
  },
  {
    id: 'truck-6w',
    name: 'Isuzu 6-Wheeler Medium Truck',
    capacity: 80,
    fixedCost: 1500,
    costPerKm: 38,
  },
  {
    id: 'truck-10w',
    name: 'Forward 10-Wheeler Heavy Freight',
    capacity: 160,
    fixedCost: 2600,
    costPerKm: 50,
  },
];

export const BASELINE_INDIVIDUAL_FIXED_COST = 1100;
export const BASELINE_INDIVIDUAL_PER_KM_COST = 32;

export const PHILIPPINE_CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  'valenzuela': { lat: 14.7011, lng: 120.983 },
  'caloocan': { lat: 14.6571, lng: 120.9841 },
  'malabon': { lat: 14.6625, lng: 120.9566 },
  'navotas': { lat: 14.6667, lng: 120.9417 },
  'quezon city': { lat: 14.676, lng: 121.0437 },
  'qc': { lat: 14.676, lng: 121.0437 },
  'marikina': { lat: 14.6507, lng: 121.1029 },
  'san juan': { lat: 14.6019, lng: 121.0355 },
  'mandaluyong': { lat: 14.5794, lng: 121.0359 },
  'manila': { lat: 14.5995, lng: 120.9842 },
  'pasig': { lat: 14.5764, lng: 121.0851 },
  'makati': { lat: 14.5547, lng: 121.0244 },
  'taguig': { lat: 14.5176, lng: 121.0509 },
  'pateros': { lat: 14.5454, lng: 121.0687 },
  'pasay': { lat: 14.5378, lng: 120.9996 },
  'parañaque': { lat: 14.4793, lng: 121.0198 },
  'paranaque': { lat: 14.4793, lng: 121.0198 },
  'las piñas': { lat: 14.4445, lng: 120.9939 },
  'las pinas': { lat: 14.4445, lng: 120.9939 },
  'muntinlupa': { lat: 14.4081, lng: 121.0415 },
  'bulacan': { lat: 14.8527, lng: 120.816 },
  'malolos': { lat: 14.8527, lng: 120.816 },
  'san jose del monte': { lat: 14.8139, lng: 121.0453 },
  'pampanga': { lat: 15.0286, lng: 120.6897 },
  'angeles': { lat: 15.145, lng: 120.5887 },
  'san fernando': { lat: 15.0286, lng: 120.6897 },
  'cavite': { lat: 14.4167, lng: 120.9333 },
  'bacoor': { lat: 14.4608, lng: 120.9419 },
  'imus': { lat: 14.4297, lng: 120.9367 },
  'dasmarinas': { lat: 14.3294, lng: 120.9367 },
  'dasmariñas': { lat: 14.3294, lng: 120.9367 },
  'tagaytay': { lat: 14.1153, lng: 120.9621 },
  'laguna': { lat: 14.214, lng: 121.168 },
  'calamba': { lat: 14.214, lng: 121.168 },
  'sta. rosa': { lat: 14.3122, lng: 121.1114 },
  'santa rosa': { lat: 14.3122, lng: 121.1114 },
  'biñan': { lat: 14.3392, lng: 121.0827 },
  'binan': { lat: 14.3392, lng: 121.0827 },
  'san pedro': { lat: 14.3592, lng: 121.0583 },
  'rizal': { lat: 14.5842, lng: 121.1763 },
  'antipolo': { lat: 14.5842, lng: 121.1763 },
  'cainta': { lat: 14.5772, lng: 121.1214 },
  'taytay': { lat: 14.5574, lng: 121.1328 },
  'batangas': { lat: 13.7565, lng: 121.0583 },
  'lipa': { lat: 13.9419, lng: 121.1644 },
  'tarlac': { lat: 15.4802, lng: 120.5979 },
  'nueva ecija': { lat: 15.4859, lng: 120.9665 },
  'cabanatuan': { lat: 15.4859, lng: 120.9665 },
  'bataan': { lat: 14.6806, lng: 120.5414 },
  'balanga': { lat: 14.6806, lng: 120.5414 },
  'zambales': { lat: 14.8386, lng: 120.2842 },
  'subic': { lat: 14.8833, lng: 120.2333 },
  'olongapo': { lat: 14.8386, lng: 120.2842 },
  'pangasinan': { lat: 16.0433, lng: 120.3333 },
  'dagupan': { lat: 16.0433, lng: 120.3333 },
  'urdaneta': { lat: 15.9761, lng: 120.5711 },
  'benguet': { lat: 16.4023, lng: 120.596 },
  'baguio': { lat: 16.4023, lng: 120.596 },
  'cebu': { lat: 10.3157, lng: 123.8854 },
  'davao': { lat: 7.1907, lng: 125.4553 },
};

export function resolveLocationCoord(cityOrRegion?: string, fallback = DEFAULT_DEPOT): LocationCoord {
  if (!cityOrRegion) return fallback;
  const query = cityOrRegion.toLowerCase().trim();

  if (PHILIPPINE_CITY_COORDINATES[query]) {
    return { name: cityOrRegion, ...PHILIPPINE_CITY_COORDINATES[query] };
  }

  for (const [key, coord] of Object.entries(PHILIPPINE_CITY_COORDINATES)) {
    if (query.includes(key) || key.includes(query)) {
      return { name: cityOrRegion, ...coord };
    }
  }

  return { ...fallback, name: cityOrRegion };
}

export function haversineDistanceKm(c1: { lat: number; lng: number }, c2: { lat: number; lng: number }): number {
  if (c1.lat === c2.lat && c1.lng === c2.lng) return 0;
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(c2.lat - c1.lat);
  const dLng = toRad(c2.lng - c1.lng);
  const lat1 = toRad(c1.lat);
  const lat2 = toRad(c2.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));

  const directDistance = R * c;
  const ROAD_WINDING_FACTOR = 1.25;
  return Math.round(directDistance * ROAD_WINDING_FACTOR * 10) / 10;
}

export function calculateRouteDistance(depot: LocationCoord, stops: DeliveryStopDto[]): number {
  if (stops.length === 0) return 0;
  let total = haversineDistanceKm(depot, stops[0].coord);
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversineDistanceKm(stops[i].coord, stops[i + 1].coord);
  }
  total += haversineDistanceKm(stops[stops.length - 1].coord, depot);
  return Math.round(total * 10) / 10;
}

export function optimizeStopSequence2Opt(depot: LocationCoord, stops: DeliveryStopDto[]): DeliveryStopDto[] {
  if (stops.length <= 2) return [...stops];

  let current = [...stops];
  let bestDistance = calculateRouteDistance(depot, current);
  let improved = true;
  let iterations = 0;
  const MAX_ITERATIONS = 50;

  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;

    for (let i = 0; i < current.length - 1; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const candidate = [
          ...current.slice(0, i),
          ...current.slice(i, j + 1).reverse(),
          ...current.slice(j + 1),
        ];

        const candidateDistance = calculateRouteDistance(depot, candidate);
        if (candidateDistance < bestDistance - 0.01) {
          current = candidate;
          bestDistance = candidateDistance;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return current;
}

export function selectBestFeasibleVehicle(unitsRequired: number, fleet: VehicleSpec[] = STANDARD_FLEET): VehicleSpec {
  const sortedFleet = [...fleet].sort((a, b) => a.capacity - b.capacity);
  for (const vehicle of sortedFleet) {
    if (vehicle.capacity >= unitsRequired) {
      return vehicle;
    }
  }
  return sortedFleet[sortedFleet.length - 1];
}

export function extractOrderDemand(order: OrderStopItem): number {
  if (order.skus && Array.isArray(order.skus) && order.skus.length > 0) {
    return order.skus.length * 6;
  }
  if (order.totalAmount && order.totalAmount > 0) {
    return Math.max(4, Math.min(30, Math.round(order.totalAmount / 3500)));
  }
  return 8;
}

export function solveCapacityConstrainedVRP(
  orders: OrderStopItem[],
  depot: LocationCoord = DEFAULT_DEPOT,
  fleet: VehicleSpec[] = STANDARD_FLEET,
  regionLabel = 'Consolidated Run'
): OptimizedRouteDto[] {
  if (orders.length === 0) return [];

  const maxVehicleCapacity = Math.max(...fleet.map((v) => v.capacity));

  const stops: DeliveryStopDto[] = orders.map((order) => {
    const city = order.deliveryCity || order.deliveryRegion || 'Metro Manila';
    const coord = resolveLocationCoord(city, depot);
    const units = extractOrderDemand(order);
    return { order, city, coord, units };
  });

  if (stops.length === 1) {
    const stop = stops[0];
    const vehicle = selectBestFeasibleVehicle(stop.units, fleet);
    const dist = calculateRouteDistance(depot, [stop]);
    const cost = Math.round(vehicle.fixedCost + dist * vehicle.costPerKm);
    const baselineDist = dist;
    const baselineCost = Math.round(BASELINE_INDIVIDUAL_FIXED_COST + baselineDist * BASELINE_INDIVIDUAL_PER_KM_COST);

    return [
      {
        routeId: `route-${regionLabel.toLowerCase().replace(/\s+/g, '-')}-1`,
        region: regionLabel,
        vehicle,
        stops: [stop],
        stopSequence: [depot.name, stop.city, depot.name],
        totalUnits: stop.units,
        capacityUtilizationPercent: Math.min(100, Math.round((stop.units / vehicle.capacity) * 100)),
        routeDistanceKm: dist,
        shippingCostPhp: cost,
        baselineDistanceKm: baselineDist,
        baselineCostPhp: baselineCost,
        savingsPhp: Math.max(0, baselineCost - cost),
        distanceReductionPercent: 0,
      },
    ];
  }

  let routes: DeliveryStopDto[][] = stops.map((s) => [s]);
  interface SavingsPair {
    i: number;
    j: number;
    savings: number;
  }
  const savingsList: SavingsPair[] = [];

  for (let i = 0; i < stops.length; i++) {
    const d0i = haversineDistanceKm(depot, stops[i].coord);
    for (let j = i + 1; j < stops.length; j++) {
      const d0j = haversineDistanceKm(depot, stops[j].coord);
      const dij = haversineDistanceKm(stops[i].coord, stops[j].coord);
      const savings = d0i + d0j - dij;
      if (savings > 0) {
        savingsList.push({ i, j, savings });
      }
    }
  }

  savingsList.sort((a, b) => b.savings - a.savings);

  const findRouteIndex = (currentRoutes: DeliveryStopDto[][], stopTarget: DeliveryStopDto): number => {
    return currentRoutes.findIndex((r) =>
      r.some((s) => s === stopTarget || (s.order?.id && stopTarget.order?.id && s.order.id === stopTarget.order.id))
    );
  };

  const getRouteUnits = (route: DeliveryStopDto[]): number => {
    return route.reduce((sum, s) => sum + s.units, 0);
  };

  for (const { i, j } of savingsList) {
    const stopI = stops[i];
    const stopJ = stops[j];

    const routeIdxI = findRouteIndex(routes, stopI);
    const routeIdxJ = findRouteIndex(routes, stopJ);

    if (routeIdxI === -1 || routeIdxJ === -1 || routeIdxI === routeIdxJ) continue;

    const routeI = routes[routeIdxI];
    const routeJ = routes[routeIdxJ];

    const combinedUnits = getRouteUnits(routeI) + getRouteUnits(routeJ);
    if (combinedUnits > maxVehicleCapacity) continue;

    const isHeadI = routeI[0] === stopI;
    const isTailI = routeI[routeI.length - 1] === stopI;
    const isHeadJ = routeJ[0] === stopJ;
    const isTailJ = routeJ[routeJ.length - 1] === stopJ;

    if ((isHeadI || isTailI) && (isHeadJ || isTailJ)) {
      let merged: DeliveryStopDto[];

      if (isTailI && isHeadJ) {
        merged = [...routeI, ...routeJ];
      } else if (isTailI && isTailJ) {
        merged = [...routeI, ...routeJ.slice().reverse()];
      } else if (isHeadI && isHeadJ) {
        merged = [...routeI.slice().reverse(), ...routeJ];
      } else {
        merged = [...routeJ, ...routeI];
      }

      routes[routeIdxI] = merged;
      routes.splice(routeIdxJ, 1);
    }
  }

  const results: OptimizedRouteDto[] = routes.map((rawStops, idx) => {
    const orderedStops = optimizeStopSequence2Opt(depot, rawStops);
    const totalUnits = getRouteUnits(orderedStops);
    const vehicle = selectBestFeasibleVehicle(totalUnits, fleet);

    const routeDistanceKm = calculateRouteDistance(depot, orderedStops);
    const shippingCostPhp = Math.round(vehicle.fixedCost + routeDistanceKm * vehicle.costPerKm);

    const baselineDistanceKm =
      Math.round(orderedStops.reduce((sum, s) => sum + 2 * haversineDistanceKm(depot, s.coord), 0) * 10) / 10;
    const baselineCostPhp = Math.round(
      orderedStops.reduce(
        (sum, s) =>
          sum + BASELINE_INDIVIDUAL_FIXED_COST + 2 * haversineDistanceKm(depot, s.coord) * BASELINE_INDIVIDUAL_PER_KM_COST,
        0
      )
    );

    const savingsPhp = Math.max(0, baselineCostPhp - shippingCostPhp);
    const distanceReductionPercent =
      baselineDistanceKm > 0
        ? Math.max(0, Math.round(((baselineDistanceKm - routeDistanceKm) / baselineDistanceKm) * 100))
        : 0;

    const stopSequence = [depot.name, ...orderedStops.map((s) => s.city), depot.name];

    return {
      routeId: `route-${regionLabel.toLowerCase().replace(/\s+/g, '-')}-${idx + 1}`,
      region: regionLabel,
      vehicle,
      stops: orderedStops,
      stopSequence,
      totalUnits,
      capacityUtilizationPercent: Math.min(100, Math.round((totalUnits / vehicle.capacity) * 100)),
      routeDistanceKm,
      shippingCostPhp,
      baselineDistanceKm,
      baselineCostPhp,
      savingsPhp,
      distanceReductionPercent,
    };
  });

  return results;
}

export function optimizeRoutes(
  orders: OrderStopItem[],
  depot: LocationCoord = DEFAULT_DEPOT,
  fleet: VehicleSpec[] = STANDARD_FLEET
): OptimizationResultDto {
  const pendingOrders = orders.filter((o) => !o.status || o.status === 'pending');
  const targetOrders = pendingOrders.length > 0 ? pendingOrders : orders;

  if (targetOrders.length === 0) {
    return {
      routes: [],
      summary: {
        totalOrders: 0,
        totalUnits: 0,
        totalVehiclesDispatched: 0,
        totalOptimizedDistanceKm: 0,
        totalOptimizedCostPhp: 0,
        totalBaselineCostPhp: 0,
        totalSavingsPhp: 0,
        overallDistanceReductionPercent: 0,
        averageCapacityUtilizationPercent: 0,
      },
    };
  }

  const regionGroups: Record<string, OrderStopItem[]> = {};
  for (const ord of targetOrders) {
    const region = ord.deliveryRegion || 'Metro Manila';
    if (!regionGroups[region]) regionGroups[region] = [];
    regionGroups[region].push(ord);
  }

  const allRoutes: OptimizedRouteDto[] = [];
  for (const [region, regOrders] of Object.entries(regionGroups)) {
    const optRoutes = solveCapacityConstrainedVRP(regOrders, depot, fleet, region);
    allRoutes.push(...optRoutes);
  }

  const totalOrders = targetOrders.length;
  const totalUnits = allRoutes.reduce((sum, r) => sum + r.totalUnits, 0);
  const totalVehiclesDispatched = allRoutes.length;
  const totalOptimizedDistanceKm = Math.round(allRoutes.reduce((sum, r) => sum + r.routeDistanceKm, 0) * 10) / 10;
  const totalOptimizedCostPhp = allRoutes.reduce((sum, r) => sum + r.shippingCostPhp, 0);
  const totalBaselineCostPhp = allRoutes.reduce((sum, r) => sum + r.baselineCostPhp, 0);
  const totalSavingsPhp = Math.max(0, totalBaselineCostPhp - totalOptimizedCostPhp);
  const totalBaselineDist = allRoutes.reduce((sum, r) => sum + r.baselineDistanceKm, 0);
  const overallDistanceReductionPercent =
    totalBaselineDist > 0
      ? Math.max(0, Math.round(((totalBaselineDist - totalOptimizedDistanceKm) / totalBaselineDist) * 100))
      : 0;
  const averageCapacityUtilizationPercent =
    allRoutes.length > 0
      ? Math.round(allRoutes.reduce((sum, r) => sum + r.capacityUtilizationPercent, 0) / allRoutes.length)
      : 0;

  return {
    routes: allRoutes,
    summary: {
      totalOrders,
      totalUnits,
      totalVehiclesDispatched,
      totalOptimizedDistanceKm,
      totalOptimizedCostPhp,
      totalBaselineCostPhp,
      totalSavingsPhp,
      overallDistanceReductionPercent,
      averageCapacityUtilizationPercent,
    },
  };
}

// ── In-Memory Persistence Stores ──────────────────────────────────────────────
const dispatchTripsStore: Map<string, DispatchTripDto> = new Map();
const trafficIncidentsStore: Map<string, TrafficIncidentDto> = new Map();

export async function createDispatchTrip(payload: DispatchTripPayload): Promise<DispatchTripDto> {
  if (!payload.vehicleName || !payload.driver || !payload.plate) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Vehicle name, driver, and license plate are required.');
  }

  const tripId = `trip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const stops = (payload.stops || []).map((s, idx) => ({
    id: `stop_${Date.now()}_${idx}`,
    orderId: s.orderId,
    orderNumber: s.orderNumber,
    clientName: s.clientName,
    deliveryCity: s.deliveryCity,
    units: s.units,
    stopSequence: s.stopSequence || idx + 1,
  }));

  const trip: DispatchTripDto = {
    id: tripId,
    vehicleId: payload.vehicleId,
    vehicleName: payload.vehicleName,
    plate: payload.plate,
    driver: payload.driver,
    region: payload.region,
    totalUnits: payload.totalUnits || stops.reduce((sum, s) => sum + s.units, 0),
    savingsPhp: payload.savingsPhp || 0,
    status: 'in_transit',
    dispatchedAt: now,
    dispatchedBy: payload.dispatchedBy,
    stops,
  };

  dispatchTripsStore.set(tripId, trip);
  return trip;
}

export async function listDispatchTrips(): Promise<DispatchTripDto[]> {
  const trips = Array.from(dispatchTripsStore.values());
  trips.sort((a, b) => new Date(b.dispatchedAt).getTime() - new Date(a.dispatchedAt).getTime());
  return trips;
}

export async function createTrafficIncident(payload: CreateTrafficIncidentPayload): Promise<TrafficIncidentDto> {
  if (!payload.corridor || !payload.delayMinutes || !payload.reporter) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Corridor, delayMinutes, and reporter name are required.');
  }

  const id = `inc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  let bypass = payload.bypassRoute;
  let timeSaved = payload.timeSavedMinutes || 20;

  if (!bypass) {
    if (payload.corridor.includes('C-5')) {
      bypass = 'Divert via BGC Lawton Ave shortcut';
      timeSaved = Math.min(19, payload.delayMinutes);
    } else if (payload.corridor.includes('SLEX')) {
      bypass = 'Take Skyway Stage 3 elevated bypass';
      timeSaved = Math.min(34, payload.delayMinutes);
    } else {
      bypass = 'Take C-5 Highway & Katipunan bypass';
      timeSaved = Math.min(28, payload.delayMinutes);
    }
  }

  const incident: TrafficIncidentDto = {
    id,
    type: payload.type,
    corridor: payload.corridor,
    delayMinutes: payload.delayMinutes,
    reporter: payload.reporter,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    bypassRoute: bypass,
    timeSavedMinutes: timeSaved,
    status: 'active',
  };

  trafficIncidentsStore.set(id, incident);
  return incident;
}

export async function listTrafficIncidents(): Promise<TrafficIncidentDto[]> {
  return Array.from(trafficIncidentsStore.values());
}

export async function rerouteTrafficIncident(incidentId: string): Promise<TrafficIncidentDto> {
  const inc = trafficIncidentsStore.get(incidentId);
  if (!inc) {
    throw new AppError(404, 'NOT_FOUND', `Traffic incident "${incidentId}" not found.`);
  }

  inc.status = 'rerouted';
  trafficIncidentsStore.set(incidentId, inc);
  return inc;
}

export async function triggerRebalance(payload: StockRebalancePayload) {
  if (!payload.productId || !payload.surplusWarehouseId || !payload.depletedWarehouseId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Product and warehouse identifiers are required for rebalance.');
  }

  const created = await transfersService.initiateTransfers({
    sourceWarehouseId: payload.surplusWarehouseId,
    destinationWarehouseId: payload.depletedWarehouseId,
    items: [
      {
        productId: payload.productId,
        quantity: payload.recommendedTransferQty,
      },
    ],
    initiatedBy: payload.initiatedBy || 'Automated Load Balancer',
    notes: `Automated rebalance of ${payload.recommendedTransferQty} units from ${
      payload.surplusWarehouseName || payload.surplusWarehouseId
    } to ${payload.depletedWarehouseName || payload.depletedWarehouseId}`,
  });

  return {
    success: true,
    transfers: created,
    message: `Scheduled ${payload.recommendedTransferQty} units to transfer between warehouses.`,
  };
}
