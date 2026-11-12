/**
 * @file action.service.ts
 * @description
 *   Service for persisting agent actions and managing agent sessions in the DB.
 *
 *   Every file operation in file.service.ts is paired with a call to
 *   logAction() here, creating an immutable audit trail of everything the
 *   agent has done.
 *
 *   Public API:
 *     createSession(payload)                     → AgentSession
 *     getSession(id)                             → AgentSession + counts
 *     listSessions()                             → AgentSession[]
 *     updateSession(id, payload)                 → AgentSession
 *     logAction(data)                            → ActionLog
 *     listActions(sessionId, page, pageSize)     → ActionLog[] + total
 *     createSnapshot(sessionId, label, treeJson) → WorkspaceSnapshot
 */

import { OperationType, SessionStatus, Prisma } from '@prisma/client';
import prisma from '../db/prisma.client';
import type {
  AgentSession,
  ActionLog,
  WorkspaceSnapshot,
} from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { FRONTEND_ROOT } from '../config/paths';

// ─── Session CRUD ─────────────────────────────────────────────────────────────

/** Creates a new agent session record. */
export async function createSession(data: {
  name: string;
  notes?: string;
  frontendRootPath?: string;
}): Promise<AgentSession> {
  const name = data.name?.trim();
  if (!name) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Session name is required.');
  }
  return prisma.agentSession.create({
    data: {
      name,
      notes:            data.notes ?? null,
      // Default to the server-configured FRONTEND_ROOT if not explicitly provided
      frontendRootPath: data.frontendRootPath ?? FRONTEND_ROOT,
      status:           'ACTIVE',
    },
  });
}

/** Returns a single session with child counts; throws 404 if not found. */
export async function getSession(
  id: string
): Promise<AgentSession & { _count: { actions: number; snapshots: number } }> {
  const session = await prisma.agentSession.findUnique({
    where: { id },
    include: { _count: { select: { actions: true, snapshots: true } } },
  });
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', `Agent session not found (id="${id}")`);
  }
  return session;
}

/** Returns all sessions, newest first. */
export async function listSessions(): Promise<
  Array<AgentSession & { _count: { actions: number; snapshots: number } }>
> {
  return prisma.agentSession.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { actions: true, snapshots: true } } },
  });
}

/** Partially updates a session (name, status, notes). */
export async function updateSession(
  id: string,
  data: { name?: string; status?: SessionStatus; notes?: string }
): Promise<AgentSession> {
  // Ensure session exists first
  await getSession(id);

  return prisma.agentSession.update({
    where: { id },
    data:  {
      ...(data.name   !== undefined && { name:   data.name   }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.notes  !== undefined && { notes:  data.notes  }),
    },
  });
}

// ─── Action Logging ───────────────────────────────────────────────────────────

/** Data needed to record an agent action. */
export interface LogActionInput {
  sessionId:    string;
  operation:    OperationType;
  targetPath:   string;
  oldPath?:     string;
  payload?:     Prisma.InputJsonValue;
  backupId?:    string;
  success:      boolean;
  errorMessage?: string;
}

/**
 * Persists a single agent operation to the action_logs table.
 * Always called AFTER the operation completes (success or failure).
 */
export async function logAction(data: LogActionInput): Promise<ActionLog> {
  return prisma.actionLog.create({
    data: {
      sessionId:    data.sessionId,
      operation:    data.operation,
      targetPath:   data.targetPath,
      oldPath:      data.oldPath    ?? null,
      payload:      data.payload    ?? Prisma.DbNull,
      backupId:     data.backupId   ?? null,
      success:      data.success,
      errorMessage: data.errorMessage ?? null,
    },
  });
}

/** Returns paginated action logs for a session, newest first. */
export async function listActions(
  sessionId: string,
  page = 1,
  pageSize = 50
): Promise<{ actions: ActionLog[]; total: number }> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePageSize = Number.isFinite(pageSize) ? Math.min(100, Math.max(1, Math.floor(pageSize))) : 50;
  const skip = (safePage - 1) * safePageSize;

  const [actions, total] = await prisma.$transaction([
    prisma.actionLog.findMany({
      where:   { sessionId },
      orderBy: { createdAt: 'desc' },
      skip,
      take:    safePageSize,
    }),
    prisma.actionLog.count({ where: { sessionId } }),
  ]);

  return { actions, total };
}

// ─── Workspace Snapshots ──────────────────────────────────────────────────────

/**
 * Saves a full directory-tree snapshot for a session.
 *
 * @param sessionId  - The session this snapshot belongs to.
 * @param label      - Human label, e.g. "Before auth refactor".
 * @param treeJson   - The FileNode tree from file.service.getDirectoryTree().
 */
export async function createSnapshot(
  sessionId: string,
  label: string,
  treeJson: object
): Promise<WorkspaceSnapshot> {
  // Ensure session exists
  await getSession(sessionId);

  return prisma.workspaceSnapshot.create({
    data: {
      sessionId,
      label,
      treeJson: treeJson as Prisma.InputJsonValue,
    },
  });
}

/** Returns all snapshots for a session, newest first. */
export async function listSnapshots(sessionId: string): Promise<WorkspaceSnapshot[]> {
  return prisma.workspaceSnapshot.findMany({
    where:   { sessionId },
    orderBy: { createdAt: 'desc' },
  });
}
