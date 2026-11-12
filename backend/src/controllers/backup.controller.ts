/**
 * @file backup.controller.ts
 * @description Controller for Database Automated Backups to CSV (FR-18 & NFR-07).
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import * as dbBackupService from '../services/databaseBackup.service';
import { ApiSuccess } from '../types/api.types';

const exportCsvQuerySchema = z.object({
  table: z
    .enum(['all', 'inventory', 'cmdb', 'orders', 'pnl', 'finance', 'expenses', 'audit', 'transfers'])
    .optional()
    .default('all'),
  download: z.enum(['true', 'false']).optional(),
});

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

/**
 * GET /api/v1/backups/export-csv
 * Streams raw CSV or returns CSV payload in JSON wrapper.
 * Query: ?table=all|inventory|orders|pnl|audit&download=true
 */
export async function exportCsv(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = exportCsvQuerySchema.safeParse({
      table: typeof req.query['table'] === 'string' ? req.query['table'].toLowerCase().trim() : undefined,
      download: typeof req.query['download'] === 'string' ? req.query['download'].trim() : undefined,
    });
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid export query parameters.');
    }

    const { table, download } = parsed.data;
    const isDownload = download === 'true';

    const result = await dbBackupService.exportDatabaseTableCsv(table);

    if (isDownload) {
      const safeFilename = result.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.status(200).send(result.csv);
      return;
    }

    ok(res, result, `Database table "${table}" exported to CSV (${result.rowCount} rows).`);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/backups/schedule-snapshot
 * Triggers an autonomous incremental database snapshot to backend/backups/.
 */
export async function createSnapshot(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const snapshot = await dbBackupService.createScheduledSnapshot();
    ok(
      res,
      snapshot,
      `Scheduled snapshot "${snapshot.snapshotId}" created successfully (${snapshot.files.length} CSV files, ${snapshot.totalBytes} bytes).`,
      201
    );
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/backups/snapshots
 * Lists available database snapshot archives.
 */
export async function listSnapshots(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const snapshots = await dbBackupService.listDatabaseSnapshots();
    ok(res, snapshots, `${snapshots.length} database snapshot archive(s) found.`);
  } catch (err) {
    next(err);
  }
}
