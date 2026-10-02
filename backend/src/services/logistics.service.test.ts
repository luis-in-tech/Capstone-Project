import * as logisticsService from './logistics.service';

describe('Logistics Optimizer Service', () => {
  it('should calculate haversine distance correctly between coordinates', () => {
    const valenzuela = logisticsService.PHILIPPINE_CITY_COORDINATES['valenzuela'];
    const caloocan = logisticsService.PHILIPPINE_CITY_COORDINATES['caloocan'];
    const dist = logisticsService.haversineDistanceKm(valenzuela, caloocan);

    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(20);
  });

  it('should optimize routes for orders using Clarke-Wright and 2-Opt', () => {
    const orders = [
      {
        id: 'ord-1',
        orderNumber: 'ORD-001',
        clientName: 'Client QC',
        deliveryCity: 'Quezon City',
        deliveryRegion: 'Metro Manila',
        status: 'pending',
        skus: ['SKU-1', 'SKU-2'],
      },
      {
        id: 'ord-2',
        orderNumber: 'ORD-002',
        clientName: 'Client Manila',
        deliveryCity: 'Manila',
        deliveryRegion: 'Metro Manila',
        status: 'pending',
        skus: ['SKU-3'],
      },
      {
        id: 'ord-3',
        orderNumber: 'ORD-003',
        clientName: 'Client Caloocan',
        deliveryCity: 'Caloocan',
        deliveryRegion: 'Metro Manila',
        status: 'pending',
        skus: ['SKU-4'],
      },
    ];

    const result = logisticsService.optimizeRoutes(orders);

    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.summary.totalOrders).toBe(3);
    expect(result.summary.totalOptimizedDistanceKm).toBeGreaterThan(0);
    expect(result.summary.totalSavingsPhp).toBeGreaterThanOrEqual(0);
  });

  it('should handle traffic incident reporting and detours', async () => {
    const incident = await logisticsService.createTrafficIncident({
      type: 'congestion',
      corridor: 'EDSA (Cubao to Balintawak)',
      delayMinutes: 45,
      reporter: 'Driver Leo',
    });

    expect(incident.id).toBeDefined();
    expect(incident.status).toBe('active');
    expect(incident.bypassRoute).toBeDefined();

    const rerouted = await logisticsService.rerouteTrafficIncident(incident.id);
    expect(rerouted.status).toBe('rerouted');
  });

  it('should create and list dispatch trips', async () => {
    const trip = await logisticsService.createDispatchTrip({
      vehicleName: 'L300 Urban Van',
      plate: 'ABC-1234',
      driver: 'Juan Dela Cruz',
      region: 'Metro Manila',
      routeId: 'route-mm-1',
      stops: [
        {
          deliveryCity: 'Quezon City',
          units: 12,
          stopSequence: 1,
        },
      ],
      dispatchedBy: 'dispatcher',
    });

    expect(trip.id).toBeDefined();
    expect(trip.status).toBe('in_transit');

    const trips = await logisticsService.listDispatchTrips();
    expect(trips.some(t => t.id === trip.id)).toBe(true);
  });
});
