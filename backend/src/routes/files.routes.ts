/**
 * @file files.routes.ts
 * @description
 *   Express router for all file-system endpoints.
 *   Middleware ordering is intentional:
 *     1. validatePath / validateRenamePaths runs FIRST to guard against traversal.
 *     2. The controller handler runs SECOND only if the path is safe.
 *
 *   Routes:
 *     GET    /tree          – Get the full directory tree
 *     GET    /read          – Read a file's content
 *     POST   /write         – Create or overwrite a file
 *     POST   /mkdir         – Create a directory
 *     PUT    /rename        – Rename / move a file or directory
 *     DELETE /delete        – Delete a file or directory (auto-backup)
 */

import { Router } from 'express';
import { validatePath, validateRenamePaths } from '../middleware/validatePath';
import { requireRole } from '../middleware/rbac.middleware';
import * as filesCtrl from '../controllers/files.controller';

const router = Router();

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /tree — restricted to admin or cmo
router.get('/tree', requireRole(['admin', 'cmo']), filesCtrl.getTree);

// GET /read?path=src%2FApp.tsx — restricted to admin or cmo, path guard validates query param
router.get('/read', requireRole(['admin', 'cmo']), validatePath, filesCtrl.readFile);

// POST /write — restricted to admin, path guard validates req.body.path
router.post('/write', requireRole(['admin', 'cmo']), validatePath, filesCtrl.writeFile);

// POST /mkdir — restricted to admin, path guard validates req.body.path
router.post('/mkdir', requireRole(['admin', 'cmo']), validatePath, filesCtrl.makeDirectory);

// PUT /rename — restricted to admin, dual-path guard validates both paths
router.put('/rename', requireRole(['admin', 'cmo']), validateRenamePaths, filesCtrl.renameEntry);

// DELETE /delete — restricted to admin, accepts path from query string or body
router.delete('/delete', requireRole(['admin', 'cmo']), validatePath, filesCtrl.deleteEntry);

export default router;
