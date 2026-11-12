/**
 * @file agent.controller.ts
 * @description
 *   Express route handlers for agent session management and action-log querying.
 *
 *   Endpoints:
 *     GET    /api/v1/agent/sessions          → listSessions
 *     POST   /api/v1/agent/sessions          → createSession
 *     GET    /api/v1/agent/sessions/:id      → getSession
 *     PATCH  /api/v1/agent/sessions/:id      → updateSession
 *     GET    /api/v1/agent/sessions/:id/actions   → listActions
 *     POST   /api/v1/agent/sessions/:id/snapshot  → createSnapshot
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import * as actionService from '../services/action.service';
import * as fileService from '../services/file.service';
import { ApiSuccess } from '../types/api.types';

// ─── Helper ───────────────────────────────────────────────────────────────────

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/agent/sessions
 * Returns all agent sessions (newest first) with action + snapshot counts.
 */
export async function listSessions(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessions = await actionService.listSessions();
    ok(res, sessions, `${sessions.length} session(s) found.`);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/agent/sessions
 * Creates a new agent session.
 * Body: { name, notes?, frontendRootPath? }
 */
const createSessionSchema = z.object({
  name: z.string().trim().min(1),
  notes: z.string().optional(),
  frontendRootPath: z.string().trim().min(1).optional(),
});

const updateSessionSchema = z.object({
  name: z.string().trim().min(1).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'TERMINATED']).optional(),
  notes: z.string().optional(),
});

const listActionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function createSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '"name" is required.' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { name, notes } = parsed.data;
    const session = await actionService.createSession({ name, notes });
    ok(res, session, 'Agent session created.', 201);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/agent/sessions/:id
 * Returns a single session with its action log and snapshots.
 */
export async function getSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : '';
    if (!id) throw new AppError(400, 'VALIDATION_ERROR', 'Session ID is required.');
    const session = await actionService.getSession(id);
    ok(res, session);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/agent/sessions/:id
 * Partially updates a session (name, status, notes).
 * Body: { name?, status?, notes? }
 */
export async function updateSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : '';
    if (!id) throw new AppError(400, 'VALIDATION_ERROR', 'Session ID is required.');
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid session update payload.');
    }
    const session = await actionService.updateSession(id, parsed.data);
    ok(res, session, 'Session updated.');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/agent/sessions/:id/actions
 * Returns a paginated list of ActionLog entries for the session.
 * Query: ?page=1&pageSize=50
 */
export async function listActions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : '';
    if (!id) throw new AppError(400, 'VALIDATION_ERROR', 'Session ID is required.');
    const parsedQuery = listActionsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid pagination query parameters.');
    }
    const { page, pageSize } = parsedQuery.data;
    const { actions, total } = await actionService.listActions(id, page, pageSize);

    ok(res, {
      items: actions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/agent/sessions/:id/snapshot
 * Takes a snapshot of the current workspace directory tree and saves it.
 * Body: { label }
 */
export async function createSnapshot(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = typeof req.params['id'] === 'string' ? req.params['id'].trim() : '';
    if (!id) throw new AppError(400, 'VALIDATION_ERROR', 'Session ID is required.');
    const parsed = z.object({ label: z.string().trim().min(1) }).safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '"label" is required.' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Capture the live directory tree
    const { tree } = fileService.getDirectoryTree();

    const snapshot = await actionService.createSnapshot(
      id,
      parsed.data.label,
      tree as object
    );

    // Log the snapshot as an action
    await actionService.logAction({
      sessionId:  id,
      operation:  'SNAPSHOT',
      targetPath: '.',
      success:    true,
      payload:    { label: snapshot.label, snapshotId: snapshot.id },
    }).catch((logErr) => {
      console.warn('[agent.controller] Failed to log SNAPSHOT action:', logErr);
    });

    ok(res, snapshot, 'Workspace snapshot created.', 201);
  } catch (err) {
    next(err);
  }
}
