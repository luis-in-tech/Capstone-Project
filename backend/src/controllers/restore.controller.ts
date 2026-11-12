/**
 * @file restore.controller.ts
 * @description
 *   Express route handlers for the backup/restore subsystem.
 *
 *   Endpoints:
 *     GET  /api/v1/restore/backups              → list all backup entries
 *     POST /api/v1/restore/backups/:id/restore  → restore a specific backup
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import * as backupService from '../services/backup.service';
import * as actionService from '../services/action.service';
import { ApiSuccess } from '../types/api.types';
import { BackupEntryDto, RestoreResult } from '../types/file.types';

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

/** Maps a Prisma BackupEntry to the safe DTO shape (converts BigInt → number). */
function toDto(entry: {
  id: string;
  originalPath: string;
  backupPath: string;
  operation: string;
  sizeBytes: bigint;
  restoredAt: Date | null;
  createdAt: Date;
}): BackupEntryDto {
  return {
    id:           entry.id,
    originalPath: entry.originalPath,
    backupPath:   entry.backupPath,
    operation:    entry.operation,
    sizeBytes:    Number(entry.sizeBytes), // BigInt → number for JSON serialisation
    restoredAt:   entry.restoredAt?.toISOString() ?? null,
    createdAt:    entry.createdAt.toISOString(),
  };
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/restore/backups
 * Lists all backup entries in the database (newest first), paginated.
 * Query: ?page=1&pageSize=20
 */
const listBackupsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const restoreBodySchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
});

export async function listBackups(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsedQuery = listBackupsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid pagination query parameters.');
    }
    const { page, pageSize } = parsedQuery.data;

    const { entries, total } = await backupService.listBackups(page, pageSize);

    ok(res, {
      items: entries.map(toDto),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    }, `${total} backup(s) found.`);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/restore/backups/:id/restore
 * Restores a backed-up file to its original location in the frontend project.
 * Body (optional): { sessionId }
 */
export async function restoreBackup(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawId = req.params['id'];
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Backup ID is required.');
    }
    const bodyParsed = restoreBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid restore payload.');
    }
    const { sessionId } = bodyParsed.data;

    const updated = await backupService.restoreBackup(id);

    const result: RestoreResult = {
      backupId:   updated.id,
      restoredTo: updated.originalPath,
      restoredAt: updated.restoredAt!.toISOString(),
    };

    // Log the restore action if a session ID is provided
    if (sessionId) {
      await actionService.logAction({
        sessionId,
        operation:  'RESTORE',
        targetPath: updated.originalPath,
        backupId:   updated.id,
        success:    true,
        payload:    { backupPath: updated.backupPath },
      }).catch((logErr) => {
        console.warn('[restore.controller] Failed to log RESTORE action:', logErr);
      });
    }

    ok(res, result, `File restored to "${updated.originalPath}".`);
  } catch (err) {
    next(err);
  }
}
