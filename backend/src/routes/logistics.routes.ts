/**
 * @file logistics.routes.ts
 * @description Express router for the Logistics Optimizer backend module.
 *
 * Routes:
 *   POST   /optimize          - Calculate optimal delivery routes with Clarke-Wright & 2-Opt
 *   POST   /dispatch-trip     - Create and record a consolidated dispatch trip
 *   GET    /dispatch-trips    - List all active and completed dispatch trips
 *   POST   /incidents         - Report traffic congestion / incident and compute detour
 *   GET    /incidents         - List active traffic incidents
 *   PATCH  /incidents/:id/reroute - Mark an incident detour pushed/rerouted
 *   POST   /rebalance         - Trigger warehouse stock rebalance transfer protocol
 */

import { Router } from 'express';
import * as logisticsCtrl from '../controllers/logistics.controller';

const router = Router();

router.post('/optimize', logisticsCtrl.optimizeRoutes);
router.post('/dispatch-trip', logisticsCtrl.dispatchTrip);
router.get('/dispatch-trips', logisticsCtrl.listDispatchTrips);
router.post('/incidents', logisticsCtrl.reportIncident);
router.get('/incidents', logisticsCtrl.listIncidents);
router.patch('/incidents/:id/reroute', logisticsCtrl.rerouteIncident);
router.post('/rebalance', logisticsCtrl.triggerRebalance);

export default router;
