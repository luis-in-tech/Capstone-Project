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
import crypto from 'crypto';
import { TRASH_DIR, resolveAndValidate, resolveCanonicalPath, isSubPath } from '../config/paths';
import prisma from '../db/prisma.client';
import { BackupEntry } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively copies a file OR an entire directory tree to the destination.
 * Uses synchronous fs calls for simplicity — these ops are fast and rare enough
 * that async overhead is not worth the complexity here.
 */
function copyRecursiveSync(src: string, dest: string): void {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    throw new AppError(403, 'SYMLINK_FORBIDDEN', `Symbolic links cannot be backed up or restored: "${src}"`);
  }

  if (stat.isDirectory()) {
    // Create the destination directory
    fs.mkdirSync(dest, { recursive: true });
    // Recursively copy all children
    for (const child of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    }
  } else if (stat.isFile()) {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  } else {
    throw new AppError(400, 'UNSUPPORTED_FILE_TYPE', `Unsupported filesystem entry type: "${src}"`);
  }
}

/**
 * Computes the total size (bytes) of a file or directory tree.
 * Returns 0 if the path does not exist or is a symlink (defensive).
 */
function computeSizeBytes(absolutePath: string): bigint {
  try {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return BigInt(0);
    if (stat.isFile()) return BigInt(stat.size);

    // For directories, sum all descendant file sizes (never traverse symlinks)
    let total = BigInt(0);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const s = fs.lstatSync(full);
        if (s.isSymbolicLink()) continue;
        if (s.isDirectory()) {
          walk(full);
        } else if (s.isFile()) {
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
  // Verify the source exists and is not a symbolic link before attempting backup
  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.lstatSync(absolutePath);
  } catch {
    throw new Error(
      `Backup failed: source path does not exist: "${absolutePath}"`
    );
  }
  if (sourceStat.isSymbolicLink()) {
    throw new AppError(403, 'SYMLINK_FORBIDDEN', `Symbolic links cannot be backed up: "${relativePath}"`);
  }

  // Build a unique, timestamped destination directory inside .trash/
  // Format: .trash/2024-01-15T10-30-00-000Z_<uid>_src-App.tsx/src/App.tsx
  const isoSafe = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueSuffix = crypto.randomUUID().slice(0, 8);
  const safeRelative = relativePath.replace(/[/\\]/g, '_'); // flatten for prefix
  const backupSlot = `${isoSafe}_${uniqueSuffix}_${safeRelative}`;
  const backupSlotDir = path.join(TRASH_DIR, backupSlot);
  const backupDest = path.join(backupSlotDir, relativePath);

  // Perform the copy; clean up staged slot dir if recursive copy fails
  try {
    copyRecursiveSync(absolutePath, backupDest);
  } catch (err) {
    fs.rmSync(backupSlotDir, { recursive: true, force: true });
    throw err;
  }

  // Measure size for metadata
  const sizeBytes = computeSizeBytes(absolutePath);

  // Persist metadata to the database; remove the staged trash copy if persistence fails
  let entry: BackupEntry;
  try {
    entry = await prisma.backupEntry.create({
      data: {
        originalPath: relativePath,
        backupPath:   backupDest,
        operation,
        sizeBytes,
      },
    });
  } catch (err) {
    fs.rmSync(backupSlotDir, { recursive: true, force: true });
    throw err;
  }

  console.log(
    `💾  Backup created: "${relativePath}" → "${backupDest}" [${sizeBytes} bytes]`
  );

  return entry;
}

/**
 * Removes an unused backup entry and its trash copy when the owning file mutation
 * failed before altering the workspace target.
 */
export async function discardBackup(backupId: string): Promise<void> {
  const entry = await prisma.backupEntry.findUnique({ where: { id: backupId } });
  if (!entry) return;
  await prisma.backupEntry.delete({ where: { id: backupId } });
  if (isSubPath(TRASH_DIR, path.resolve(entry.backupPath))) {
    const slotRelative = path.relative(TRASH_DIR, path.resolve(entry.backupPath)).split(/[\\/]/)[0];
    if (slotRelative && slotRelative !== '.' && slotRelative !== '..') {
      fs.rmSync(path.join(TRASH_DIR, slotRelative), { recursive: true, force: true });
    }
  }
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
    throw new AppError(404, 'BACKUP_NOT_FOUND', `Restore failed: backup entry not found (id="${backupId}")`);
  }
  if (entry.restoredAt) {
    throw new AppError(
      409,
      'ALREADY_RESTORED',
      `Restore failed: backup "${backupId}" was already restored at ${entry.restoredAt.toISOString()}`
    );
  }

  // Verify the backup path stays strictly inside TRASH_DIR (prevent arbitrary host copy on DB/path tampering)
  let canonicalTrash: string;
  let canonicalBackup: string;
  try {
    canonicalTrash = resolveCanonicalPath(TRASH_DIR);
    canonicalBackup = resolveCanonicalPath(entry.backupPath);
  } catch {
    throw new AppError(403, 'PATH_TRAVERSAL', `Backup copy "${entry.backupPath}" escapes the trash directory.`);
  }
  if (!isSubPath(TRASH_DIR, path.resolve(entry.backupPath)) || !isSubPath(canonicalTrash, canonicalBackup)) {
    throw new AppError(403, 'PATH_TRAVERSAL', `Backup copy "${entry.backupPath}" escapes the trash directory.`);
  }

  // Verify the backup file still exists in .trash/ and is not a symlink
  let backupStat: fs.Stats;
  try {
    backupStat = fs.lstatSync(entry.backupPath);
  } catch {
    throw new AppError(
      404,
      'BACKUP_FILE_MISSING',
      `Restore failed: backup copy no longer exists at "${entry.backupPath}"`
    );
  }
  if (backupStat.isSymbolicLink()) {
    throw new AppError(403, 'SYMLINK_FORBIDDEN', `Symbolic links cannot be restored: "${entry.backupPath}"`);
  }

  // Resolve the restoration destination with security validation
  const restoreDest = resolveAndValidate(entry.originalPath);
  try {
    if (fs.lstatSync(restoreDest).isSymbolicLink()) {
      throw new AppError(403, 'SYMLINK_FORBIDDEN', `Cannot restore over symbolic link: "${entry.originalPath}"`);
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }

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
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(100, Math.floor(pageSize)) : 20;
  const skip = (safePage - 1) * safePageSize;

  const [entries, total] = await prisma.$transaction([
    prisma.backupEntry.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: safePageSize,
    }),
    prisma.backupEntry.count(),
  ]);

  return { entries, total };
}
