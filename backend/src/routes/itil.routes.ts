/**
 * @file itil.routes.ts
 * @description Express router for ITIL SLA Monitoring and Quarantine endpoints (FR-06 & FR-11).
 *
 * Routes:
 *   GET    /sla-incidents                - Evaluate and retrieve active SLA breach incidents
 *   POST   /quarantine                   - Log defective stock exception and quarantine units
 *   GET    /quarantine                   - List quarantined items with filtering
 *   GET    /quarantine/supplier-report   - Download Defective Products Report CSV for supplier returns
 */

import { Router } from 'express';
import * as itilCtrl from '../controllers/itil.controller';

const router = Router();

router.get('/sla-incidents', itilCtrl.getSlaIncidents);
router.post('/quarantine', itilCtrl.createQuarantineTicket);
router.get('/quarantine', itilCtrl.listQuarantineTickets);
router.get('/quarantine/supplier-report', itilCtrl.exportSupplierReport);

export default router;
