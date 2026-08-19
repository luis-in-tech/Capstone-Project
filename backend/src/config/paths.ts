/**
 * @file paths.ts
 * @description Resolves and exports all critical filesystem paths used by the backend.
 *
 * Key safety invariant:
 *   FRONTEND_ROOT  = the single directory the agent may operate inside.
 *   BACKEND_ROOT   = the backend/ directory itself — always EXCLUDED from agent access.
 *   TRASH_DIR      = backend/.trash/ — where all backups live before restore.
 */

import path from 'path';
import fs from 'fs';
import { env } from './env';

// ─── Resolved Paths ───────────────────────────────────────────────────────────

/**
 * Canonical absolute path of the frontend project root.
 * Normalised via path.resolve to strip trailing slashes and handle ".." segments.
 */
export const FRONTEND_ROOT: string = path.resolve(env.FRONTEND_ROOT);

/**
 * Canonical absolute path of this backend/ directory.
 * Derived from __dirname (src/config/) going up two levels.
 */
export const BACKEND_ROOT: string = path.resolve(__dirname, '..', '..');

/**
 * Where all pre-destructive-op backups are stored.
 * Lives INSIDE backend/ so it is never under the agent's jurisdiction.
 * Structure: .trash/<ISO-timestamp>-<uuid>/<relative-original-path>
 */
export const TRASH_DIR: string = path.join(BACKEND_ROOT, '.trash');

// ─── Bootstrap .trash/ ────────────────────────────────────────────────────────

/**
 * Ensures the .trash directory exists when the server starts.
 * Called once at startup — idempotent.
 */
export function ensureTrashDir(): void {
  if (!fs.existsSync(TRASH_DIR)) {
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    console.log(`📁  Created backup/trash directory: ${TRASH_DIR}`);
  }
}

// ─── Guard Utility ────────────────────────────────────────────────────────────

/**
 * Returns true if the given absolute path is safely within FRONTEND_ROOT
 * AND does NOT enter BACKEND_ROOT.
 *
 * This is the core path-traversal safety check.
 *
 * @param absolutePath - The resolved absolute path to validate.
 */
export function isPathSafe(absolutePath: string): boolean {
  const normalised = path.normalize(absolutePath);
  const isInsideFrontend = normalised.startsWith(FRONTEND_ROOT + path.sep) || normalised === FRONTEND_ROOT;
  const isInsideBackend = normalised.startsWith(BACKEND_ROOT + path.sep) || normalised === BACKEND_ROOT;
  return isInsideFrontend && isInsideBackend;
}

/**
 * Resolves a relative path from the frontend root to an absolute path,
 * then asserts it is safe.
 *
 * @param relativePath - e.g. "src/App.tsx"
 * @returns Resolved absolute path
 * @throws Error if the resolved path escapes the frontend root
 */
export function resolveAndValidate(relativePath: string): string {
  const absolute = path.resolve(FRONTEND_ROOT, relativePath);
  if (!isPathSafe(absolute)) {
    throw new Error(
      `Path traversal detected: "${relativePath}" resolves outside the allowed directory.`
    );
  }

