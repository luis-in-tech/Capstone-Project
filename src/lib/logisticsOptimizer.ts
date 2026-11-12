// ══════════════════════════════════════════════════════════════════════════════
// FR-24: Custom Team-Programmed Mathematical Logistics Optimizer
// Core heuristics: Clarke–Wright Savings for capacity-constrained route construction
//                  followed by 2-Opt local search for stop sequence optimization.
// Zero external unstructured AI dependencies.
// ══════════════════════════════════════════════════════════════════════════════

import type { Order } from '../types';

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

export const DEFAULT_DEPOT: LocationCoord = {
  name: 'Valenzuela Central Logistics Hub',
  lat: 14.7011,
  lng: 120.9830,
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

// Baseline individual courier dispatch rates (unconsolidated round-trip per customer)
export const BASELINE_INDIVIDUAL_FIXED_COST = 1100;
export const BASELINE_INDIVIDUAL_PER_KM_COST = 32;

// Philippine Regional Coordinates Map (Depot + Municipalities & Provincial Hubs)
export const PHILIPPINE_CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  // Metro Manila
  'metro manila': { lat: 14.5995, lng: 120.9842 },
  'ncr': { lat: 14.5995, lng: 120.9842 },
  'valenzuela': { lat: 14.7011, lng: 120.9830 },
  'caloocan': { lat: 14.6571, lng: 120.9841 },
  'malabon': { lat: 14.6625, lng: 120.9566 },
  'navotas': { lat: 14.6667, lng: 120.9417 },
  'quezon city': { lat: 14.6760, lng: 121.0437 },
  'qc': { lat: 14.6760, lng: 121.0437 },
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

  // Provincial Luzon
  'albay': { lat: 13.1391, lng: 123.7438 },
  'legazpi': { lat: 13.1391, lng: 123.7438 },
  'aurora': { lat: 15.7585, lng: 121.5608 },
  'baler': { lat: 15.7585, lng: 121.5608 },
  'batanes': { lat: 20.4487, lng: 121.9702 },
  'basco': { lat: 20.4487, lng: 121.9702 },
  'bulacan': { lat: 14.8527, lng: 120.8160 },
  'malolos': { lat: 14.8527, lng: 120.8160 },
  'san jose del monte': { lat: 14.8139, lng: 121.0453 },
  'cagayan': { lat: 17.6132, lng: 121.7270 },
  'tuguegarao': { lat: 17.6132, lng: 121.7270 },
  'camarines norte': { lat: 14.1122, lng: 122.9553 },
  'daet': { lat: 14.1122, lng: 122.9553 },
  'camarines sur': { lat: 13.6218, lng: 123.1948 },
  'naga': { lat: 13.6218, lng: 123.1948 },
  'catanduanes': { lat: 13.5844, lng: 124.2372 },
  'virac': { lat: 13.5844, lng: 124.2372 },
  'pampanga': { lat: 15.0286, lng: 120.6897 },
  'angeles': { lat: 15.1450, lng: 120.5887 },
  'san fernando': { lat: 15.0286, lng: 120.6897 },
  'ifugao': { lat: 16.8017, lng: 121.1194 },
  'lagawe': { lat: 16.8017, lng: 121.1194 },
  'ilocos norte': { lat: 18.1978, lng: 120.5936 },
  'laoag': { lat: 18.1978, lng: 120.5936 },
  'ilocos sur': { lat: 17.5747, lng: 120.3869 },
  'vigan': { lat: 17.5747, lng: 120.3869 },
  'isabela': { lat: 17.1485, lng: 121.8891 },
  'ilagan': { lat: 17.1485, lng: 121.8891 },
  'cauayan': { lat: 16.9275, lng: 121.7706 },
  'kalinga': { lat: 17.4086, lng: 121.4447 },
  'tabuk': { lat: 17.4086, lng: 121.4447 },
  'la union': { lat: 16.6159, lng: 120.3209 },
  'la union (san fernando)': { lat: 16.6159, lng: 120.3209 },
  'san fernando, la union': { lat: 16.6159, lng: 120.3209 },
  'san fernando la union': { lat: 16.6159, lng: 120.3209 },
  'marinduque': { lat: 13.4463, lng: 121.8400 },
  'boac': { lat: 13.4463, lng: 121.8400 },
  'masbate': { lat: 12.3717, lng: 123.6247 },
  'masbate city': { lat: 12.3717, lng: 123.6247 },
  'mountain province': { lat: 17.0886, lng: 120.9767 },
  'bontoc': { lat: 17.0886, lng: 120.9767 },
  'cavite': { lat: 14.4167, lng: 120.9333 },
  'bacoor': { lat: 14.4608, lng: 120.9419 },
  'imus': { lat: 14.4297, lng: 120.9367 },
  'dasmarinas': { lat: 14.3294, lng: 120.9367 },
  'dasmariñas': { lat: 14.3294, lng: 120.9367 },
  'tagaytay': { lat: 14.1153, lng: 120.9621 },
  'laguna': { lat: 14.2140, lng: 121.1680 },
  'calamba': { lat: 14.2140, lng: 121.1680 },
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
  'batangas city': { lat: 13.7565, lng: 121.0583 },
  'lipa': { lat: 13.9419, lng: 121.1644 },
  'tarlac': { lat: 15.4802, lng: 120.5979 },
  'tarlac city': { lat: 15.4802, lng: 120.5979 },
  'nueva ecija': { lat: 15.4859, lng: 120.9665 },
  'cabanatuan': { lat: 15.4859, lng: 120.9665 },
  'palayan': { lat: 15.5415, lng: 121.0848 },
  'nueva vizcaya': { lat: 16.4813, lng: 121.1489 },
  'bayombong': { lat: 16.4813, lng: 121.1489 },
  'occidental mindoro': { lat: 12.3528, lng: 121.0676 },
  'oriental mindoro': { lat: 13.4117, lng: 121.1803 },
  'calapan': { lat: 13.4117, lng: 121.1803 },
  'palawan': { lat: 9.7392, lng: 118.7353 },
  'puerto princesa': { lat: 9.7392, lng: 118.7353 },
  'quirino': { lat: 16.5067, lng: 121.5228 },
  'cabarroguis': { lat: 16.5067, lng: 121.5228 },
  'romblon': { lat: 12.5778, lng: 122.2691 },
  'sorsogon': { lat: 12.9742, lng: 124.0058 },
  'sorsogon city': { lat: 12.9742, lng: 124.0058 },
  'bataan': { lat: 14.6806, lng: 120.5414 },
  'balanga': { lat: 14.6806, lng: 120.5414 },
  'zambales': { lat: 14.8386, lng: 120.2842 },
  'subic': { lat: 14.8833, lng: 120.2333 },
  'olongapo': { lat: 14.8386, lng: 120.2842 },
  'pangasinan': { lat: 16.0433, lng: 120.3333 },
  'dagupan': { lat: 16.0433, lng: 120.3333 },
  'urdaneta': { lat: 15.9761, lng: 120.5711 },
  'benguet': { lat: 16.4023, lng: 120.5960 },
  'baguio': { lat: 16.4023, lng: 120.5960 },
  'baguio city': { lat: 16.4023, lng: 120.5960 },
  'quezon province': { lat: 13.9314, lng: 121.6172 },
  'lucena': { lat: 13.9314, lng: 121.6172 },

  // Visayas
  'aklan': { lat: 11.7061, lng: 122.3649 },
  'kalibo': { lat: 11.7061, lng: 122.3649 },
  'boracay': { lat: 11.9674, lng: 121.9248 },
  'antique': { lat: 10.7450, lng: 121.9410 },
  'biliran': { lat: 11.5608, lng: 124.3964 },
  'naval': { lat: 11.5608, lng: 124.3964 },
  'capiz': { lat: 11.5853, lng: 122.7511 },
  'roxas city': { lat: 11.5853, lng: 122.7511 },
  'roxas': { lat: 11.5853, lng: 122.7511 },
  'cebu': { lat: 10.3157, lng: 123.8854 },
  'cebu city': { lat: 10.3157, lng: 123.8854 },
  'mandaue': { lat: 10.3333, lng: 123.9333 },
  'lapu-lapu': { lat: 10.3103, lng: 123.9494 },
  'talisay': { lat: 10.2447, lng: 123.8494 },
  'eastern samar': { lat: 11.6081, lng: 125.4319 },
  'borongan': { lat: 11.6081, lng: 125.4319 },
  'guimaras': { lat: 10.6542, lng: 122.5961 },
  'jordan': { lat: 10.6542, lng: 122.5961 },
  'iloilo': { lat: 10.7202, lng: 122.5621 },
  'iloilo city': { lat: 10.7202, lng: 122.5621 },
  'leyte': { lat: 11.2442, lng: 125.0039 },
  'negros occidental': { lat: 10.6766, lng: 122.9509 },
  'bacolod': { lat: 10.6766, lng: 122.9509 },
  'negros oriental': { lat: 9.3068, lng: 123.3054 },
  'dumaguete': { lat: 9.3068, lng: 123.3054 },
  'northern samar': { lat: 12.4989, lng: 124.6378 },
  'catarman': { lat: 12.4989, lng: 124.6378 },
  'samar': { lat: 11.7753, lng: 124.8861 },
  'western samar': { lat: 11.7753, lng: 124.8861 },
  'catbalogan': { lat: 11.7753, lng: 124.8861 },
  'calbayog': { lat: 12.0676, lng: 124.5955 },
  'siquijor': { lat: 9.2144, lng: 123.5150 },
  'southern leyte': { lat: 10.1336, lng: 124.8447 },
  'maasin': { lat: 10.1336, lng: 124.8447 },
  'tacloban': { lat: 11.2442, lng: 125.0039 },
  'ormoc': { lat: 11.0064, lng: 124.6075 },
  'bohol': { lat: 9.6729, lng: 123.8730 },
  'tagbilaran': { lat: 9.6729, lng: 123.8730 },

  // Mindanao
  'agusan del norte': { lat: 8.9475, lng: 125.5406 },
  'butuan': { lat: 8.9475, lng: 125.5406 },
  'agusan del sur': { lat: 8.5060, lng: 125.9784 },
  'basilan': { lat: 6.7041, lng: 121.9712 },
  'isabela city': { lat: 6.7041, lng: 121.9712 },
  'lamitan': { lat: 6.6540, lng: 122.1380 },
  'bukidnon': { lat: 8.1575, lng: 125.1277 },
  'malaybalay': { lat: 8.1575, lng: 125.1277 },
  'camiguin': { lat: 9.2504, lng: 124.7219 },
  'mambajao': { lat: 9.2504, lng: 124.7219 },
  'cotabato city': { lat: 7.2236, lng: 124.2464 },
  'davao': { lat: 7.1907, lng: 125.4553 },
  'davao city': { lat: 7.1907, lng: 125.4553 },
  'metro davao': { lat: 7.1907, lng: 125.4553 },
  'davao de oro': { lat: 7.6061, lng: 125.9669 },
  'nabunturan': { lat: 7.6061, lng: 125.9669 },
  'davao del norte': { lat: 7.4479, lng: 125.8078 },
  'tagum': { lat: 7.4479, lng: 125.8078 },
  'panabo': { lat: 7.3081, lng: 125.6842 },
  'davao del sur': { lat: 6.7495, lng: 125.3572 },
  'digos': { lat: 6.7495, lng: 125.3572 },
  'davao occidental': { lat: 6.4083, lng: 125.6167 },
  'malita': { lat: 6.4083, lng: 125.6167 },
  'davao oriental': { lat: 6.9551, lng: 126.2166 },
  'mati': { lat: 6.9551, lng: 126.2166 },
  'dinagat islands': { lat: 10.1282, lng: 125.6095 },
  'cagayan de oro': { lat: 8.4542, lng: 124.6319 },
  'misamis oriental': { lat: 8.4542, lng: 124.6319 },
  'iligan city': { lat: 8.2280, lng: 124.2452 },
  'iligan': { lat: 8.2280, lng: 124.2452 },
  'lanao del norte': { lat: 8.2280, lng: 124.2452 },
  'lanao del sur': { lat: 8.0034, lng: 124.2928 },
  'marawi': { lat: 8.0034, lng: 124.2928 },
  'maguindanao': { lat: 7.1319, lng: 124.4214 },
  'maguindanao del norte': { lat: 7.1319, lng: 124.4214 },
  'maguindanao del sur': { lat: 6.8900, lng: 124.5100 },
  'misamis occidental': { lat: 8.1482, lng: 123.8405 },
  'ozamiz': { lat: 8.1482, lng: 123.8405 },
  'oroquieta': { lat: 8.4847, lng: 123.8047 },
  'north cotabato': { lat: 7.0083, lng: 125.0894 },
  'kidapawan': { lat: 7.0083, lng: 125.0894 },
  'general santos': { lat: 6.1164, lng: 125.1716 },
  'general santos city': { lat: 6.1164, lng: 125.1716 },
  'gensan': { lat: 6.1164, lng: 125.1716 },
  'sarangani': { lat: 6.1008, lng: 125.2869 },
  'alabel': { lat: 6.1008, lng: 125.2869 },
  'south cotabato': { lat: 6.5031, lng: 124.8469 },
  'koronadal': { lat: 6.5031, lng: 124.8469 },
  'sultan kudarat': { lat: 6.6914, lng: 124.6778 },
  'tacurong': { lat: 6.6914, lng: 124.6778 },
  'isulan': { lat: 6.6295, lng: 124.6050 },
  'sulu': { lat: 6.0522, lng: 121.0022 },
  'jolo': { lat: 6.0522, lng: 121.0022 },
  'surigao del norte': { lat: 9.7890, lng: 125.4950 },
  'surigao city': { lat: 9.7890, lng: 125.4950 },
  'siargao': { lat: 9.8482, lng: 126.0458 },
  'surigao del sur': { lat: 9.0784, lng: 126.1986 },
  'tandag': { lat: 9.0784, lng: 126.1986 },
  'bislig': { lat: 8.2108, lng: 126.3164 },
  'tawi-tawi': { lat: 5.0292, lng: 119.7731 },
  'bongao': { lat: 5.0292, lng: 119.7731 },
  'zamboanga': { lat: 6.9214, lng: 122.0790 },
  'zamboanga city': { lat: 6.9214, lng: 122.0790 },
  'zamboanga del norte': { lat: 8.5889, lng: 123.3408 },
  'dipolog': { lat: 8.5889, lng: 123.3408 },
  'dapitan': { lat: 8.6542, lng: 123.4233 },
  'zamboanga del sur': { lat: 7.8257, lng: 123.4370 },
  'pagadian': { lat: 7.8257, lng: 123.4370 },
  'zamboanga sibugay': { lat: 7.7844, lng: 122.5861 },
  'ipil': { lat: 7.7844, lng: 122.5861 },
};

const SORTED_COORDINATE_ENTRIES = Object.entries(PHILIPPINE_CITY_COORDINATES).sort(
  ([a], [b]) => b.length - a.length
);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolves coordinates for a given city/region string with fallback matching.
 */
export function resolveLocationCoord(cityOrRegion?: string, fallback = DEFAULT_DEPOT): LocationCoord {
  if (!cityOrRegion) return fallback;
  const query = cityOrRegion.toLowerCase().trim();
  if (!query) return fallback;

  // 1. Direct match
  if (PHILIPPINE_CITY_COORDINATES[query]) {
    return { name: cityOrRegion, ...PHILIPPINE_CITY_COORDINATES[query] };
  }

  // 2. Word-boundary longest-key match (avoids short substrings like 'qc' or 'san fernando' colliding)
  for (const [key, coord] of SORTED_COORDINATE_ENTRIES) {
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(key)}(?:$|[^a-z0-9])`);
    if (pattern.test(query)) {
      return { name: cityOrRegion, ...coord };
    }
  }

  // 3. Fallback based on macro-region
  if (query.includes('visayas') || query.includes('cebu')) {
    return { name: cityOrRegion, ...PHILIPPINE_CITY_COORDINATES['cebu'] };
  }
  if (query.includes('mindanao') || query.includes('davao')) {
    return { name: cityOrRegion, ...PHILIPPINE_CITY_COORDINATES['davao'] };
  }
  if (query.includes('luzon')) {
    return { name: cityOrRegion, ...PHILIPPINE_CITY_COORDINATES['laguna'] };
  }

  return { ...fallback, name: cityOrRegion };
}

/**
 * Calculates Great-Circle distance via the Haversine formula, adjusted by
 * the Philippine road tortuosity/winding multiplier (1.25x actual highway network).
 */
export function haversineDistanceKm(c1: { lat: number; lng: number }, c2: { lat: number; lng: number }): number {
  if (c1.lat === c2.lat && c1.lng === c2.lng) return 0;
  const R = 6371; // Earth's radius in kilometers
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
  const ROAD_WINDING_FACTOR = 1.25; // accounts for actual road infrastructure
  return Math.round(directDistance * ROAD_WINDING_FACTOR * 10) / 10;
}

export interface DeliveryStop {
  order: Order;
  city: string;
  coord: LocationCoord;
  units: number; // demand in boxes/items
}

export interface OptimizedRoute {
  routeId: string;
  region: string;
  vehicle: VehicleSpec;
  stops: DeliveryStop[];
  stopSequence: string[]; // e.g. ['Valenzuela Hub', 'Caloocan', 'QC', 'Manila', 'Valenzuela Hub']
  totalUnits: number;
  capacityUtilizationPercent: number;
  routeDistanceKm: number;
  shippingCostPhp: number;
  baselineDistanceKm: number;
  baselineCostPhp: number;
  savingsPhp: number;
  distanceReductionPercent: number;
}

export interface OptimizationResult {
  routes: OptimizedRoute[];
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

/**
 * Extracts box/item unit demand for an order.
 */
export function extractOrderDemand(order: Order): number {
  if ((order as any).items && Array.isArray((order as any).items) && (order as any).items.length > 0) {
    const totalItemQty = (order as any).items.reduce((sum: number, it: any) => sum + Number(it.quantity || 0), 0);
    if (totalItemQty > 0) return totalItemQty;
  }
  if (order.skus && Array.isArray(order.skus) && order.skus.length > 0) {
    return order.skus.length * 6; // Standard 6 units per SKU bundle
  }
  if (order.totalAmount && order.totalAmount > 0) {
    return Math.max(1, Math.round(order.totalAmount / 3500));
  }
  return 8;
}

/**
 * Calculates total route distance visiting stops in order:
 * Depot -> Stop 0 -> Stop 1 -> ... -> Stop n-1 -> Depot
 */
export function calculateRouteDistance(depot: LocationCoord, stops: DeliveryStop[]): number {
  if (stops.length === 0) return 0;
  let total = haversineDistanceKm(depot, stops[0].coord);
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversineDistanceKm(stops[i].coord, stops[i + 1].coord);
  }
  total += haversineDistanceKm(stops[stops.length - 1].coord, depot);
  return Math.round(total * 10) / 10;
}

/**
 * 2-Opt Local Search Heuristic for sequence optimization.
 * Refines the visiting order of stops to eliminate self-crossings and reduce route distance.
 */
export function optimizeStopSequence2Opt(depot: LocationCoord, stops: DeliveryStop[]): DeliveryStop[] {
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
        // Reverse sub-route between i and j
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

/**
 * Selects the most cost-effective vehicle from the fleet that satisfies the capacity constraint.
 */
export function selectBestFeasibleVehicle(unitsRequired: number, fleet: VehicleSpec[] = STANDARD_FLEET): VehicleSpec {
  const validFleet = (fleet && fleet.length > 0 ? fleet : STANDARD_FLEET).filter(
    v => Number.isFinite(v.capacity) && v.capacity > 0
  );
  const activeFleet = validFleet.length > 0 ? validFleet : STANDARD_FLEET;
  const sortedFleet = [...activeFleet].sort((a, b) => a.capacity - b.capacity);
  for (const vehicle of sortedFleet) {
    if (vehicle.capacity >= unitsRequired) {
      return vehicle;
    }
  }
  // If exceeds largest single vehicle, return the heavy truck
  return sortedFleet[sortedFleet.length - 1];
}

export function solveCapacityConstrainedVRP(
  orders: Order[],
  depot: LocationCoord = DEFAULT_DEPOT,
  fleet: VehicleSpec[] = STANDARD_FLEET,
  regionLabel = 'Consolidated Run'
): OptimizedRoute[] {
  if (orders.length === 0) return [];

  const validFleet = (fleet && fleet.length > 0 ? fleet : STANDARD_FLEET).filter(
    v => Number.isFinite(v.capacity) && v.capacity > 0
  );
  const activeFleet = validFleet.length > 0 ? validFleet : STANDARD_FLEET;
  const maxVehicleCapacity = Math.max(...activeFleet.map(v => v.capacity));

  // Build delivery stops, splitting any stop exceeding max fleet capacity
  const stops: DeliveryStop[] = [];
  for (const order of orders) {
    const city = order.deliveryCity || order.deliveryRegion || 'Metro Manila';
    const coord = resolveLocationCoord(city, depot);
    const demand = extractOrderDemand(order);

    if (demand > maxVehicleCapacity) {
      let remaining = demand;
      let part = 1;
      while (remaining > 0) {
        const chunk = Math.min(maxVehicleCapacity, remaining);
        stops.push({
          order: { ...order, id: `${order.id}-part${part}` },
          city,
          coord,
          units: chunk,
        });
        remaining -= chunk;
        part++;
      }
    } else {
      stops.push({ order, city, coord, units: demand });
    }
  }

  // Handle single order case directly
  if (stops.length === 1) {
    const stop = stops[0];
    const vehicle = selectBestFeasibleVehicle(stop.units, activeFleet);
    const dist = calculateRouteDistance(depot, [stop]);
    const cost = Math.round(vehicle.fixedCost + dist * vehicle.costPerKm);
    const baselineDist = dist;
    const baselineCost = Math.round(BASELINE_INDIVIDUAL_FIXED_COST + baselineDist * BASELINE_INDIVIDUAL_PER_KM_COST);

    return [{
      routeId: `route-${regionLabel.toLowerCase().replace(/\s+/g, '-')}-1`,
      region: regionLabel,
      vehicle,
      stops: [stop],
      stopSequence: [depot.name, stop.city, depot.name],
      totalUnits: stop.units,
      capacityUtilizationPercent: Math.round((stop.units / vehicle.capacity) * 100),
      routeDistanceKm: dist,
      shippingCostPhp: cost,
      baselineDistanceKm: baselineDist,
      baselineCostPhp: baselineCost,
      savingsPhp: baselineCost - cost,
      distanceReductionPercent: 0,
    }];
  }

  // 1. Initial routes: Each stop is in its own individual route [stop]
  let routes: DeliveryStop[][] = stops.map(s => [s]);

  // 2. Pre-calculate savings matrix S(i, j) = d(0, i) + d(0, j) - d(i, j)
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
      if (savings >= 0) {
        savingsList.push({ i, j, savings });
      }
    }
  }

  // 3. Sort pairs in descending order of savings
  savingsList.sort((a, b) => b.savings - a.savings);

  // Helper to find which route contains a given stop reference
  const findRouteIndex = (currentRoutes: DeliveryStop[][], stopTarget: DeliveryStop): number => {
    return currentRoutes.findIndex(r => r.some(s => s === stopTarget));
  };

  // Helper to sum route units
  const getRouteUnits = (route: DeliveryStop[]): number => {
    return route.reduce((sum, s) => sum + s.units, 0);
  };

  // 4. Merge routes based on Clarke-Wright savings
  for (const { i, j } of savingsList) {
    const stopI = stops[i];
    const stopJ = stops[j];

    const routeIdxI = findRouteIndex(routes, stopI);
    const routeIdxJ = findRouteIndex(routes, stopJ);

    // Cannot merge if already in the same route
    if (routeIdxI === -1 || routeIdxJ === -1 || routeIdxI === routeIdxJ) continue;

    const routeI = routes[routeIdxI];
    const routeJ = routes[routeIdxJ];

    // Capacity constraint check
    const combinedUnits = getRouteUnits(routeI) + getRouteUnits(routeJ);
    if (combinedUnits > maxVehicleCapacity) continue;

    // Check if stopI is an exterior endpoint of routeI
    const isHeadI = routeI[0] === stopI;
    const isTailI = routeI[routeI.length - 1] === stopI;

    // Check if stopJ is an exterior endpoint of routeJ
    const isHeadJ = routeJ[0] === stopJ;
    const isTailJ = routeJ[routeJ.length - 1] === stopJ;

    if ((isHeadI || isTailI) && (isHeadJ || isTailJ)) {
      let merged: DeliveryStop[];

      if (isTailI && isHeadJ) {
        // [ ...I ] + [ J... ]
        merged = [...routeI, ...routeJ];
      } else if (isTailI && isTailJ) {
        // [ ...I ] + reverse([ ...J ])
        merged = [...routeI, ...routeJ.slice().reverse()];
      } else if (isHeadI && isHeadJ) {
        // reverse([ I... ]) + [ J... ]
        merged = [...routeI.slice().reverse(), ...routeJ];
      } else {
        // isHeadI && isTailJ -> [ ...J ] + [ I... ]
        merged = [...routeJ, ...routeI];
      }

      // Replace routeI and remove routeJ
      routes[routeIdxI] = merged;
      routes.splice(routeIdxJ, 1);
    }
  }

  // 5. Post-process each route with 2-Opt local search, select best vehicle & compute savings
  const results: OptimizedRoute[] = routes.map((rawStops, idx) => {
    // 2-Opt sequence refinement
    const orderedStops = optimizeStopSequence2Opt(depot, rawStops);
    const totalUnits = getRouteUnits(orderedStops);
    const vehicle = selectBestFeasibleVehicle(totalUnits, activeFleet);

    const routeDistanceKm = calculateRouteDistance(depot, orderedStops);
    const shippingCostPhp = Math.round(vehicle.fixedCost + routeDistanceKm * vehicle.costPerKm);

    // Unoptimized baseline: individual trips depot -> customer -> depot
    const baselineDistanceKm = Math.round(
      orderedStops.reduce((sum, s) => sum + 2 * haversineDistanceKm(depot, s.coord), 0) * 10
    ) / 10;
    const baselineCostPhp = Math.round(
      orderedStops.reduce(
        (sum, s) => sum + BASELINE_INDIVIDUAL_FIXED_COST + 2 * haversineDistanceKm(depot, s.coord) * BASELINE_INDIVIDUAL_PER_KM_COST,
        0
      )
    );

    const savingsPhp = baselineCostPhp - shippingCostPhp;
    const distanceReductionPercent =
      baselineDistanceKm > 0
        ? Math.round(((baselineDistanceKm - routeDistanceKm) / baselineDistanceKm) * 100)
        : 0;

    const stopSequence = [
      depot.name,
      ...orderedStops.map(s => s.city),
      depot.name,
    ];

    return {
      routeId: `route-${regionLabel.toLowerCase().replace(/\s+/g, '-')}-${idx + 1}`,
      region: regionLabel,
      vehicle,
      stops: orderedStops,
      stopSequence,
      totalUnits,
      capacityUtilizationPercent: Math.round((totalUnits / vehicle.capacity) * 100),
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

/**
 * Top-level optimizer entrypoint: clusters orders by macro-region (Metro Manila, Luzon, Visayas, Mindanao)
 * and executes the Clarke-Wright + 2-Opt heuristic on each cluster.
 */
export function calculateOptimalLogisticsRoutes(
  orders: Order[],
  depot: LocationCoord = DEFAULT_DEPOT,
  fleet: VehicleSpec[] = STANDARD_FLEET
): OptimizationResult {
  const targetOrders = orders.filter(o => o.status === 'pending');

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

  // Group by deliveryRegion
  const regionGroups: Record<string, Order[]> = {};
  for (const ord of targetOrders) {
    const region = ord.deliveryRegion || 'Metro Manila';
    if (!regionGroups[region]) regionGroups[region] = [];
    regionGroups[region].push(ord);
  }

  const allRoutes: OptimizedRoute[] = [];
  for (const [region, regOrders] of Object.entries(regionGroups)) {
    const optRoutes = solveCapacityConstrainedVRP(regOrders, depot, fleet, region);
    allRoutes.push(...optRoutes);
  }

  // Compute aggregate summary
  const totalOrders = targetOrders.length;
  const totalUnits = allRoutes.reduce((sum, r) => sum + r.totalUnits, 0);
  const totalVehiclesDispatched = allRoutes.length;
  const totalOptimizedDistanceKm = Math.round(allRoutes.reduce((sum, r) => sum + r.routeDistanceKm, 0) * 10) / 10;
  const totalOptimizedCostPhp = allRoutes.reduce((sum, r) => sum + r.shippingCostPhp, 0);
  const totalBaselineCostPhp = allRoutes.reduce((sum, r) => sum + r.baselineCostPhp, 0);
  const totalSavingsPhp = totalBaselineCostPhp - totalOptimizedCostPhp;
  const totalBaselineDist = allRoutes.reduce((sum, r) => sum + r.baselineDistanceKm, 0);
  const overallDistanceReductionPercent =
    totalBaselineDist > 0
      ? Math.round(((totalBaselineDist - totalOptimizedDistanceKm) / totalBaselineDist) * 100)
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
