/**
 * @file transfers.routes.ts
 * @description Express router for the Transfers backend module.
 *
 * Routes:
 *   GET    /                     - List transfers with pagination and status filters
 *   GET    /audit-logs           - List stock audit log entries for transfers
 *   GET    /:id                  - Get single transfer by ID
 *   POST   /initiate             - Initiate new transfer requests
 *   POST   /:id/dispatch         - Mark transfer in_transit and deduct origin stock
 *   POST   /:id/receive          - Confirm arrival and credit destination warehouse
 *   POST   /:id/cancel           - Cancel transfer and reinstate stock if in_transit
 */

import { Router } from 'express';
import * as transfersCtrl from '../controllers/transfers.controller';

const router = Router();

router.get('/', transfersCtrl.listTransfers);
router.get('/audit-logs', transfersCtrl.getAuditLogs);
router.get('/:id', transfersCtrl.getTransferById);

router.post('/initiate', transfersCtrl.initiateTransfers);
router.post('/:id/dispatch', transfersCtrl.dispatchTransfer);
router.post('/:id/receive', transfersCtrl.receiveTransfer);
router.post('/:id/cancel', transfersCtrl.cancelTransfer);

export default router;
