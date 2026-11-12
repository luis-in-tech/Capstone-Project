/**
 * @file file.service.ts
 * @description
 *   Core filesystem service — all file and directory operations performed by
 *   the agent go through this module.
 *
 *   Safety contract:
 *     • Paths are assumed to be ALREADY VALIDATED absolute paths (via
 *       validatePath middleware + resolveAndValidate). This service does NOT
 *       re-validate paths; that is the middleware's responsibility.
 *     • Destructive ops (write-overwrite, rename, delete) MUST call the
 *       backup service BEFORE mutating anything.
 *
 *   Public API:
 *     getDirectoryTree(absoluteRoot)             → FileNode
 *     readFile(absolutePath)                     → FileReadResult
 *     writeFile(absolutePath, content, relative) → FileWriteResult
 *     makeDirectory(absolutePath)                → MkdirResult
 *     renameEntry(absOld, absNew, relOld, relNew) → RenameResult
 *     deleteEntry(absolutePath, relativePath)    → DeleteResult
 */

import fs from 'fs';
import path from 'path';
import { FRONTEND_ROOT, isSubPath } from '../config/paths';
import { backupFile, discardBackup } from './backup.service';
import {
  FileNode,
  FileReadResult,
  FileWriteResult,
  MkdirResult,
  RenameResult,
  DeleteResult,
  DirectoryTree,
} from '../types/file.types';
import { AppError } from '../middleware/errorHandler';

// ─── MIME Hint Map ─────────────────────────────────────────────────────────────

/** Maps common extensions to rough MIME-like labels for the frontend to use. */
const MIME_HINTS: Record<string, string> = {
  ts: 'text/typescript', tsx: 'text/typescript-react',
  js: 'text/javascript',  jsx: 'text/javascript-react',
  json: 'application/json', md: 'text/markdown',
  css: 'text/css', html: 'text/html',
  env: 'text/env', txt: 'text/plain',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  prisma: 'text/prisma', yaml: 'text/yaml', yml: 'text/yaml',
  sh: 'text/shell', gitignore: 'text/plain',
};

function getMimeHint(ext: string): string {
  const key = ext.toLowerCase();
  return Object.prototype.hasOwnProperty.call(MIME_HINTS, key) ? MIME_HINTS[key] : 'application/octet-stream';
}

// ─── Directory to skip when building the tree ────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.trash']);
const MAX_TREE_DEPTH = 15;
const MAX_READ_BYTES = 10 * 1024 * 1024; // 10 MB read safety limit

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts an absolute path to a path relative to the frontend root,
 * using forward slashes for cross-platform consistency.
 */
function toRelative(absolutePath: string): string {
  return path.relative(FRONTEND_ROOT, absolutePath).replace(/\\/g, '/');
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Recursively builds a FileNode tree for the given directory.
 * Skips common noise directories (node_modules, .git, dist, .trash).
 *
 * @param dirPath - Absolute path of the directory to scan.
 */
function buildTree(dirPath: string, depth = 0): FileNode {
  const stat = fs.lstatSync(dirPath);
  const name = path.basename(dirPath);
  const relative = toRelative(dirPath);

  if (stat.isSymbolicLink()) {
    throw new AppError(400, 'SYMLINK_SKIPPED', `Symbolic links are skipped: "${relative}"`);
  }

  if (stat.isFile()) {
    const ext = path.extname(name).replace('.', '');
    return {
      name,
      path: relative,
      type: 'file',
      sizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
      extension: ext,
    };
  }

  if (depth >= MAX_TREE_DEPTH) {
    return { name, path: relative, type: 'directory', children: [] };
  }

  // It's a directory — recurse into children
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const children: FileNode[] = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue; // skip noisy dirs and symlinks

    try {
      children.push(buildTree(path.join(dirPath, entry.name), depth + 1));
    } catch {
      // Skip files we can't read (permissions, broken symlinks, etc.)
    }
  }

  // Sort: directories first, then files, alphabetically within each group
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { name, path: relative, type: 'directory', children };
}

/**
 * Returns the full recursive directory tree of the frontend root.
 */
export function getDirectoryTree(): DirectoryTree {
  const rootNode = buildTree(FRONTEND_ROOT);
  return {
    rootPath: FRONTEND_ROOT,
    generatedAt: new Date().toISOString(),
    tree: rootNode,
  };
}

/**
 * Reads a file's content as a UTF-8 string.
 *
 * @param absolutePath - Validated absolute path to read.
 * @throws AppError 404 if the file does not exist.
 * @throws AppError 400 if the path is a directory.
 */
function inspectExistingLstat(absolutePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(absolutePath);
  } catch (err: any) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export function readFile(absolutePath: string): FileReadResult {
  const stat = inspectExistingLstat(absolutePath);
  if (!stat) {
    throw new AppError(404, 'NOT_FOUND', `File not found: "${toRelative(absolutePath)}"`);
  }
  if (stat.isSymbolicLink()) {
    throw new AppError(403, 'SYMLINK_FORBIDDEN', `Symbolic links cannot be read: "${toRelative(absolutePath)}"`);
  }
  if (stat.isDirectory()) {
    throw new AppError(400, 'IS_DIRECTORY', `The path "${toRelative(absolutePath)}" is a directory, not a file.`);
  }
  if (!stat.isFile()) {
    throw new AppError(400, 'UNSUPPORTED_FILE_TYPE', `The path "${toRelative(absolutePath)}" is not a regular file.`);
  }
  if (stat.size > MAX_READ_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', `File exceeds 10 MB read limit (${stat.size} bytes).`);
  }

  const raw = fs.readFileSync(absolutePath);
  if (raw.includes(0)) {
    throw new AppError(
      415,
      'BINARY_FILE',
      `File "${toRelative(absolutePath)}" appears to be a binary file and cannot be read as UTF-8 text.`
    );
  }
  const content = raw.toString('utf-8');
  const name = path.basename(absolutePath);
  const ext = path.extname(name).replace('.', '');

  return {
    path:         toRelative(absolutePath),
    content,
    encoding:     'utf-8',
    sizeBytes:    stat.size,
    lastModified: stat.mtime.toISOString(),
    mimeHint:     getMimeHint(ext),
  };
}

/**
 * Creates or overwrites a file with the given content.
 * If the file already exists, it is backed up BEFORE being overwritten.
 *
 * @param absolutePath  - Validated absolute path to write to.
 * @param relativePath  - Relative path (for backup metadata).
 * @param content       - UTF-8 string content to write.
 * @returns FileWriteResult including backup ID if an overwrite occurred.
 */
export async function writeFile(
  absolutePath: string,
  relativePath: string,
  content: string
): Promise<FileWriteResult> {
  const existingStat = inspectExistingLstat(absolutePath);
  if (existingStat?.isSymbolicLink()) {
    throw new AppError(403, 'SYMLINK_FORBIDDEN', `Symbolic links cannot be overwritten: "${relativePath}"`);
  }
  if (existingStat?.isDirectory()) {
    throw new AppError(400, 'IS_DIRECTORY', `Cannot overwrite directory "${relativePath}" with a file.`);
  }

  const existed = existingStat !== null;
  let backupId: string | undefined;

  if (existed) {
    // ⚠️  SAFETY: Back up the existing file BEFORE overwriting
    const backup = await backupFile(absolutePath, relativePath, 'WRITE');
    backupId = backup.id;
  }

  try {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    // Write the file
    fs.writeFileSync(absolutePath, content, 'utf-8');
  } catch (err) {
    if (backupId) {
      await discardBackup(backupId).catch(() => {});
    }
    throw err;
  }
  const stat = fs.lstatSync(absolutePath);

  return {
    path:       relativePath,
    sizeBytes:  stat.size,
    overwrote:  existed,
    backupId,
    writtenAt:  new Date().toISOString(),
  };
}

/**
 * Creates a directory (and all necessary parent directories) at the given path.
 *
 * @param absolutePath - Validated absolute path of the directory to create.
 * @throws AppError 409 if the directory already exists.
 */
export function makeDirectory(absolutePath: string): MkdirResult {
  const existingStat = inspectExistingLstat(absolutePath);
  if (existingStat) {
    if (existingStat.isSymbolicLink()) {
      throw new AppError(403, 'SYMLINK_FORBIDDEN', `Path "${toRelative(absolutePath)}" is a symbolic link.`);
    }
    throw new AppError(409, 'ALREADY_EXISTS', `Directory already exists: "${toRelative(absolutePath)}"`);
  }

  fs.mkdirSync(absolutePath, { recursive: true });

  return {
    path:      toRelative(absolutePath),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Renames or moves a file/directory.
 * The source is backed up BEFORE the rename operation.
 *
 * @param absOldPath  - Validated absolute current path.
 * @param absNewPath  - Validated absolute destination path.
 * @param relOldPath  - Relative old path (for backup metadata).
 * @param relNewPath  - Relative new path (for response).
 */
export async function renameEntry(
  absOldPath: string,
  absNewPath: string,
  relOldPath: string,
  relNewPath: string
): Promise<RenameResult> {
  const oldStat = inspectExistingLstat(absOldPath);
  if (!oldStat) {
    throw new AppError(404, 'NOT_FOUND', `Source not found: "${relOldPath}"`);
  }
  if (oldStat.isSymbolicLink()) {
    throw new AppError(403, 'SYMLINK_FORBIDDEN', `Symbolic links cannot be renamed: "${relOldPath}"`);
  }

  const normOld = process.platform === 'win32' ? path.resolve(absOldPath).toLowerCase() : path.resolve(absOldPath);
  const normNew = process.platform === 'win32' ? path.resolve(absNewPath).toLowerCase() : path.resolve(absNewPath);
  if (normOld === normNew) {
    throw new AppError(400, 'INVALID_RENAME', `Source and destination paths are identical: "${relOldPath}"`);
  }
  if (oldStat.isDirectory() && isSubPath(absOldPath, absNewPath)) {
    throw new AppError(400, 'INVALID_RENAME', `Cannot move directory "${relOldPath}" inside itself ("${relNewPath}").`);
  }

  const existingDest = inspectExistingLstat(absNewPath);
  if (existingDest) {
    throw new AppError(409, 'ALREADY_EXISTS', `Destination already exists: "${relNewPath}"`);
  }

  // ⚠️  SAFETY: Back up source before rename
  const backup = await backupFile(absOldPath, relOldPath, 'RENAME');

  try {
    // Ensure the destination parent directory exists
    fs.mkdirSync(path.dirname(absNewPath), { recursive: true });
    fs.renameSync(absOldPath, absNewPath);
  } catch (err) {
    await discardBackup(backup.id).catch(() => {});
    throw err;
  }

  return {
    oldPath:    relOldPath,
    newPath:    relNewPath,
    backupId:   backup.id,
    renamedAt:  new Date().toISOString(),
  };
}

/**
 * Deletes a file or directory recursively.
 * The target is backed up BEFORE deletion.
 *
 * @param absolutePath  - Validated absolute path to delete.
 * @param relativePath  - Relative path (for backup metadata + response).
 */
export async function deleteEntry(
  absolutePath: string,
  relativePath: string
): Promise<DeleteResult> {
  const stat = inspectExistingLstat(absolutePath);
  if (!stat) {
    throw new AppError(404, 'NOT_FOUND', `Path not found: "${relativePath}"`);
  }
  if (stat.isSymbolicLink()) {
    throw new AppError(403, 'SYMLINK_FORBIDDEN', `Symbolic links cannot be deleted through workspace API: "${relativePath}"`);
  }

  // ⚠️  SAFETY: Back up BEFORE deleting — no delete without a receipt
  const backup = await backupFile(absolutePath, relativePath, 'DELETE');

  try {
    // Remove file or recursively remove directory
    if (stat.isDirectory()) {
      fs.rmSync(absolutePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(absolutePath);
    }
  } catch (err) {
    await discardBackup(backup.id).catch(() => {});
    throw err;
  }

  return {
    path:       relativePath,
    backupId:   backup.id,
    deletedAt:  new Date().toISOString(),
  };
}
