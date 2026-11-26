/**
 * @file backup.routes.ts
 * @description Express router for Database Automated Backups to CSV endpoints (FR-18 & NFR-07).
 *
 * Routes:
 *   GET    /export-csv           - Export database tables (CMDB, Orders, P&L, Audit) into CSV
 *   POST   /schedule-snapshot    - Create autonomous scheduled backup snapshot to local archive
 *   GET    /snapshots            - List backup snapshot archives
 */

import { Router } from 'express';
import { requireRole } from '../middleware/rbac.middleware';
import * as backupCtrl from '../controllers/backup.controller';

const router = Router();
router.use(requireRole(['admin', 'cmo']));

router.get('/export-csv', backupCtrl.exportCsv);
router.post('/schedule-snapshot', backupCtrl.createSnapshot);
router.get('/snapshots', backupCtrl.listSnapshots);

export default router;
