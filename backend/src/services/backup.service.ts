/**
 * @file backup.service.ts
 * @description
 *   Pre-destructive-operation backup service.
 *   ─────────────────────────────────────────────────────────────────────────
 *   Before any WRITE (overwrite), RENAME, or DELETE operation, the backend
 *   AUTOMATICALLY calls this service to copy the target file/directory into
 *   backend/.trash/<timestamp>/<relative-path>.
 *
 *   This guarantees the agent can always recover from mistakes.
 *   ─────────────────────────────────────────────────────────────────────────
 *
 *   Public API:
 *     backupFile(absolutePath, relativePath, operation)  → BackupEntry (DB row)
 *     isBackedUp(backupId)                               → boolean
 */

import fs from 'fs';
import path from 'path';
import { TRASH_DIR, FRONTEND_ROOT, resolveAndValidate } from '../config/paths';
import prisma from '../db/prisma.client';
import { BackupEntry } from '@prisma/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively copies a file OR an entire directory tree to the destination.
 * Uses synchronous fs calls for simplicity — these ops are fast and rare enough
 * that async overhead is not worth the complexity here.
 */
function copyRecursiveSync(src: string, dest: string): void {
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    // Create the destination directory
    fs.mkdirSync(dest, { recursive: true });
    // Recursively copy all children
    for (const child of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    }
  } else {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/**
 * Computes the total size (bytes) of a file or directory tree.
 * Returns 0 if the path does not exist (defensive).
 */
function computeSizeBytes(absolutePath: string): bigint {
  try {
    const stat = fs.statSync(absolutePath);
    if (stat.isFile()) return BigInt(stat.size);

    // For directories, sum all descendant file sizes
    let total = BigInt(0);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const s = fs.statSync(full);
        if (s.isDirectory()) {
          walk(full);
        } else {
          total += BigInt(s.size);
        }
      }
    };
    walk(absolutePath);
    return total;
  } catch {
    return BigInt(0);
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Creates a backup of the target file/directory in backend/.trash/
 * and records the backup metadata in the `backup_entries` table.
 *
 * @param absolutePath  - The full absolute path of the file to back up.
 * @param relativePath  - Relative path from the frontend root (for DB storage).
 * @param operation     - The operation that triggered this backup (e.g. "DELETE").
 * @returns             The created BackupEntry database record.
 * @throws              If the source does not exist or the copy fails.
 */
export async function backupFile(
  absolutePath: string,
  relativePath: string,
  operation: string
): Promise<BackupEntry> {
  // Verify the source exists before attempting backup
  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Backup failed: source path does not exist: "${absolutePath}"`
    );
  }

  // Build a unique, timestamped destination directory inside .trash/
  // Format: .trash/2024-01-15T10-30-00-000Z_src-App.tsx/src/App.tsx
  const isoSafe = new Date().toISOString().replace(/[:.]/g, '-');
  const safeRelative = relativePath.replace(/[/\\]/g, '_'); // flatten for prefix
  const backupSlot = `${isoSafe}_${safeRelative}`;
  const backupDest = path.join(TRASH_DIR, backupSlot, relativePath);

  // Perform the copy
  copyRecursiveSync(absolutePath, backupDest);

  // Measure size for metadata
  const sizeBytes = computeSizeBytes(absolutePath);

  // Persist metadata to the database
  const entry = await prisma.backupEntry.create({
    data: {
      originalPath: relativePath,
      backupPath:   backupDest,
      operation,
      sizeBytes,
    },
  });

  console.log(
    `💾  Backup created: "${relativePath}" → "${backupDest}" [${sizeBytes} bytes]`
  );

  return entry;
}

/**
 * Restores a backed-up file/directory from .trash/ back to its original
 * location within the frontend root, then marks the BackupEntry as restored.
 *
 * @param backupId - The cuid of the BackupEntry to restore.
 * @returns The updated BackupEntry record.
 * @throws If the backup entry is not found, already restored, or the copy fails.
 */
export async function restoreBackup(backupId: string): Promise<BackupEntry> {
  // Fetch the backup record
  const entry = await prisma.backupEntry.findUnique({ where: { id: backupId } });
  if (!entry) {
    throw new Error(`Restore failed: backup entry not found (id="${backupId}")`);
  }
  if (entry.restoredAt) {
    throw new Error(
      `Restore failed: backup "${backupId}" was already restored at ${entry.restoredAt.toISOString()}`
    );
  }

  // Verify the backup file still exists in .trash/
  if (!fs.existsSync(entry.backupPath)) {
    throw new Error(
      `Restore failed: backup copy no longer exists at "${entry.backupPath}"`
    );
  }

  // Resolve the restoration destination with security validation
  const restoreDest = resolveAndValidate(entry.originalPath);

  // Ensure parent directory exists at destination
  fs.mkdirSync(path.dirname(restoreDest), { recursive: true });

  // Copy from .trash/ back to the original location
  copyRecursiveSync(entry.backupPath, restoreDest);

  // Mark as restored in the DB
  const updated = await prisma.backupEntry.update({
    where: { id: backupId },
    data:  { restoredAt: new Date() },
  });

  console.log(`♻️   Restored: "${entry.originalPath}" ← "${entry.backupPath}"`);

  return updated;
}

/**
 * Returns a paginated list of all backup entries, newest first.
 *
 * @param page     - 1-indexed page number
 * @param pageSize - Items per page
 */
export async function listBackups(
  page = 1,
  pageSize = 20
): Promise<{ entries: BackupEntry[]; total: number }> {
  const skip = (page - 1) * pageSize;

  const [entries, total] = await prisma.$transaction([
    prisma.backupEntry.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.backupEntry.count(),
  ]);

  return { entries, total };
}
