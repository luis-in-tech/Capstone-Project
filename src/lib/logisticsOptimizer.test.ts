import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_DEPOT,
  STANDARD_FLEET,
  resolveLocationCoord,
  haversineDistanceKm,
  extractOrderDemand,
  calculateRouteDistance,
  optimizeStopSequence2Opt,
  selectBestFeasibleVehicle,
  solveCapacityConstrainedVRP,
  calculateOptimalLogisticsRoutes,
  DeliveryStop,
} from './logisticsOptimizer';
import type { Order } from '../types';

test('haversine distance calculates positive symmetric distance with triangle inequality', () => {
  const valenzuela = resolveLocationCoord('Valenzuela');
  const manila = resolveLocationCoord('Manila');
  const qc = resolveLocationCoord('Quezon City');

  const dValManila = haversineDistanceKm(valenzuela, manila);
  const dManilaVal = haversineDistanceKm(manila, valenzuela);
  assert.equal(dValManila, dManilaVal, 'Distance should be symmetric');
  assert.ok(dValManila > 0, 'Distance from Valenzuela to Manila should be positive');

  // Triangle inequality: d(A, C) <= d(A, B) + d(B, C)
  const dValQC = haversineDistanceKm(valenzuela, qc);
  const dQCManila = haversineDistanceKm(qc, manila);
  assert.ok(
    dValManila <= dValQC + dQCManila + 0.1,
    'Distance satisfies triangle inequality'
  );
});

test('location coordinate resolver matches known Philippine cities and handles unknown fallbacks', () => {
  const caloocan = resolveLocationCoord('Caloocan');
  assert.equal(caloocan.name, 'Caloocan');
  assert.ok(caloocan.lat > 14.5 && caloocan.lat < 14.8);

  const cavite = resolveLocationCoord('Cavite (Bacoor / Imus)');
  assert.ok(cavite.lat > 14.2 && cavite.lat < 14.6);

  const unknown = resolveLocationCoord('Unknown Fantasy Town', DEFAULT_DEPOT);
  assert.equal(unknown.lat, DEFAULT_DEPOT.lat);
  assert.equal(unknown.lng, DEFAULT_DEPOT.lng);
});

test('order demand extractor prioritizes SKUs and falls back to monetary volume', () => {
  const orderWithSkus = {
    id: 'ord-1',
    skus: ['SHI-M8100', 'MAX-IKON'],
    totalAmount: 12000,
  } as Order;
  assert.equal(extractOrderDemand(orderWithSkus), 12); // 2 skus * 6 units

  const orderWithoutSkus = {
    id: 'ord-2',
    skus: [],
    totalAmount: 35000,
  } as Order;
  assert.equal(extractOrderDemand(orderWithoutSkus), 10); // 35000 / 3500 = 10
});

test('selectBestFeasibleVehicle assigns the smallest vehicle that meets capacity constraints', () => {
  const van = selectBestFeasibleVehicle(25, STANDARD_FLEET);
  assert.equal(van.id, 'van');
  assert.equal(van.capacity, 40);

  const mediumTruck = selectBestFeasibleVehicle(65, STANDARD_FLEET);
  assert.equal(mediumTruck.id, 'truck-6w');
  assert.equal(mediumTruck.capacity, 80);

  const heavyTruck = selectBestFeasibleVehicle(120, STANDARD_FLEET);
  assert.equal(heavyTruck.id, 'truck-10w');
  assert.equal(heavyTruck.capacity, 160);
});

test('2-opt heuristic reduces or maintains route distance on crossed delivery stops', () => {
  const stops: DeliveryStop[] = [
    {
      order: { id: 'o-1' } as Order,
      city: 'Caloocan',
      coord: resolveLocationCoord('Caloocan'),
      units: 10,
    },
    {
      order: { id: 'o-2' } as Order,
      city: 'Muntinlupa', // Far south
      coord: resolveLocationCoord('Muntinlupa'),
      units: 10,
    },
    {
      order: { id: 'o-3' } as Order,
      city: 'Quezon City', // North-central
      coord: resolveLocationCoord('Quezon City'),
      units: 10,
    },
    {
      order: { id: 'o-4' } as Order,
      city: 'Parañaque', // South
      coord: resolveLocationCoord('Parañaque'),
      units: 10,
    },
  ];

  const initialDistance = calculateRouteDistance(DEFAULT_DEPOT, stops);
  const optimized = optimizeStopSequence2Opt(DEFAULT_DEPOT, stops);
  const optimizedDistance = calculateRouteDistance(DEFAULT_DEPOT, optimized);

  assert.ok(
    optimizedDistance <= initialDistance,
    `2-Opt must improve or maintain distance (Initial: ${initialDistance}, Optimized: ${optimizedDistance})`
  );
});

test('solveCapacityConstrainedVRP enforces vehicle capacity constraints and beats baseline costs', () => {
  const sampleOrders: Order[] = [
    {
      id: 'o-1',
      orderNumber: 'ORD-101',
      clientName: 'Client QC',
      status: 'pending',
      deliveryRegion: 'Metro Manila',
      deliveryCity: 'Quezon City',
      skus: ['SKU-1', 'SKU-2'], // 12 units
      totalAmount: 25000,
      paymentStatus: 'paid',
      agentId: 'a1',
      clientId: 'c1',
      deliveryDeadline: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'o-2',
      orderNumber: 'ORD-102',
      clientName: 'Client Caloocan',
      status: 'pending',
      deliveryRegion: 'Metro Manila',
      deliveryCity: 'Caloocan',
      skus: ['SKU-3'], // 6 units
      totalAmount: 18000,
      paymentStatus: 'paid',
      agentId: 'a1',
      clientId: 'c2',
      deliveryDeadline: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'o-3',
      orderNumber: 'ORD-103',
      clientName: 'Client Manila',
      status: 'pending',
      deliveryRegion: 'Metro Manila',
      deliveryCity: 'Manila',
      skus: ['SKU-4', 'SKU-5', 'SKU-6'], // 18 units
      totalAmount: 42000,
      paymentStatus: 'paid',
      agentId: 'a1',
      clientId: 'c3',
      deliveryDeadline: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const routes = solveCapacityConstrainedVRP(sampleOrders, DEFAULT_DEPOT, STANDARD_FLEET, 'Metro Manila');
  assert.ok(routes.length >= 1, 'Should produce at least one route');

  for (const route of routes) {
    // Capacity constraint
    assert.ok(
      route.totalUnits <= route.vehicle.capacity,
      `Route total units (${route.totalUnits}) must not exceed vehicle capacity (${route.vehicle.capacity})`
    );
    // Baseline comparison
    assert.ok(
      route.shippingCostPhp <= route.baselineCostPhp,
      `Optimized cost (₱${route.shippingCostPhp}) should be less than or equal to unoptimized baseline (₱${route.baselineCostPhp})`
    );
    assert.ok(route.savingsPhp >= 0, 'Savings should be non-negative');
    assert.ok(route.stopSequence.length >= 3, 'Sequence must start and end at Depot');
    assert.equal(route.stopSequence[0], DEFAULT_DEPOT.name);
    assert.equal(route.stopSequence[route.stopSequence.length - 1], DEFAULT_DEPOT.name);
  }
});

test('calculateOptimalLogisticsRoutes clusters by region and handles empty sets gracefully', () => {
  const emptyResult = calculateOptimalLogisticsRoutes([]);
  assert.equal(emptyResult.routes.length, 0);
  assert.equal(emptyResult.summary.totalOrders, 0);
  assert.equal(emptyResult.summary.totalSavingsPhp, 0);

  const mixedOrders: Order[] = [
    {
      id: 'm-1',
      orderNumber: 'ORD-MM-1',
      clientName: 'Manila Shop',
      status: 'pending',
      deliveryRegion: 'Metro Manila',
      deliveryCity: 'Pasig',
      skus: ['A', 'B'],
      totalAmount: 30000,
      paymentStatus: 'paid',
      agentId: 'a',
      clientId: 'c',
      deliveryDeadline: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'm-2',
      orderNumber: 'ORD-LUZ-1',
      clientName: 'Cavite Hub',
      status: 'pending',
      deliveryRegion: 'Luzon',
      deliveryCity: 'Cavite (Imus)',
      skus: ['C'],
      totalAmount: 20000,
      paymentStatus: 'paid',
      agentId: 'a',
      clientId: 'c',
      deliveryDeadline: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const result = calculateOptimalLogisticsRoutes(mixedOrders, DEFAULT_DEPOT, STANDARD_FLEET);
  assert.equal(result.routes.length, 2, 'Should create separate routes for Metro Manila and Luzon');
  assert.equal(result.summary.totalOrders, 2);
  assert.ok(result.summary.totalSavingsPhp >= 0);
});
