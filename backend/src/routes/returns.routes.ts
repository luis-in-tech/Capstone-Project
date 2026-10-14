/**
 * @file returns.routes.ts
 * @description Express router for Returns & Exchange Processing endpoints (FR-17).
 *
 * Routes:
 *   POST   /process      - Process customer return/exchange, restock viable items, adjust ledger
 *   GET    /             - List returns with filtering & pagination
 *   GET    /audit-trail  - Get audit trail for return adjustments
 *   GET    /:id          - Get single return record by ID
 */

import { Router } from 'express';
import * as returnsCtrl from '../controllers/returns.controller';

const router = Router();

router.post('/process', returnsCtrl.processReturn);
router.get('/', returnsCtrl.listReturns);
router.get('/audit-trail', returnsCtrl.getReturnAuditTrail);
router.get('/:id', returnsCtrl.getReturnById);

export default router;
