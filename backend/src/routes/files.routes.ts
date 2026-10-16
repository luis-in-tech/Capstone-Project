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

// Require administrative privileges for all file operations
router.use(requireRole(['admin', 'cmo']));

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /tree — no path guard needed (returns the entire configured root)
router.get('/tree', filesCtrl.getTree);

// GET /read?path=src%2FApp.tsx — path guard validates the query param
router.get('/read', validatePath, filesCtrl.readFile);

// POST /write — path guard validates req.body.path
router.post('/write', validatePath, filesCtrl.writeFile);

// POST /mkdir — path guard validates req.body.path
router.post('/mkdir', validatePath, filesCtrl.makeDirectory);

// PUT /rename — dual-path guard validates both oldPath and newPath in body
router.put('/rename', validateRenamePaths, filesCtrl.renameEntry);

// DELETE /delete — accepts path from query string OR body
router.delete('/delete', validatePath, filesCtrl.deleteEntry);

export default router;
