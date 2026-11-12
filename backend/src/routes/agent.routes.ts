/**
 * @file agent.routes.ts
 * @description
 *   Express router for agent session management endpoints.
 *
 *   Routes:
 *     GET    /sessions                        – List all sessions
 *     POST   /sessions                        – Create a new session
 *     GET    /sessions/:id                    – Get a session by ID
 *     PATCH  /sessions/:id                    – Update session (name/status/notes)
 *     GET    /sessions/:id/actions            – Paginated action log for a session
 *     POST   /sessions/:id/snapshot           – Take a workspace tree snapshot
 */

import { Router } from 'express';
import { requireRole } from '../middleware/rbac.middleware';
import * as agentCtrl from '../controllers/agent.controller';

const router = Router();
router.use(requireRole(['admin', 'cmo']));

// ─── Session Routes ────────────────────────────────────────────────────────────

router.get( '/sessions',                  agentCtrl.listSessions);
router.post('/sessions',                  agentCtrl.createSession);
router.get( '/sessions/:id',              agentCtrl.getSession);
router.patch('/sessions/:id',             agentCtrl.updateSession);

// ─── Action Log ────────────────────────────────────────────────────────────────

router.get('/sessions/:id/actions',       agentCtrl.listActions);

// ─── Snapshots ─────────────────────────────────────────────────────────────────

router.post('/sessions/:id/snapshot',     agentCtrl.createSnapshot);

export default router;
