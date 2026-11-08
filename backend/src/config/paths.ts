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
 * Sensitive file patterns that must NEVER be served through the files API,
 * even when they reside inside FRONTEND_ROOT.
 * Prevents exposure of credentials, secrets, and VCS metadata.
 */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,          // .env, .env.local, .env.production, etc.
  /^\.git(\/|\\|$)/i,         // .git directory and contents
  /\.pem$/i,                  // TLS/SSH private keys
  /\.key$/i,                  // Private key files
  /^config\.toml$/i,          // Supabase config
];

/**
 * Returns true if the given absolute path is safely within FRONTEND_ROOT,
 * does NOT enter BACKEND_ROOT, and does NOT target a sensitive file.
 *
 * This is the core path-traversal and secrets-exposure safety check.
 *
 * @param absolutePath - The resolved absolute path to validate.
 */
export function isPathSafe(absolutePath: string): boolean {
  const normalised = path.normalize(absolutePath);
  const normTarget = process.platform === 'win32' ? normalised.toLowerCase() : normalised;
  const normFrontend = process.platform === 'win32' ? FRONTEND_ROOT.toLowerCase() : FRONTEND_ROOT;
  const normBackend = process.platform === 'win32' ? BACKEND_ROOT.toLowerCase() : BACKEND_ROOT;

  const isInsideFrontend = normTarget.startsWith(normFrontend + path.sep) || normTarget === normFrontend;
  const isInsideBackend = normTarget.startsWith(normBackend + path.sep) || normTarget === normBackend;

  if (!isInsideFrontend || isInsideBackend) {
    return false;
  }

  // Block sensitive files by checking basename and relative path segments
  const basename = path.basename(absolutePath);
  const relativeFromRoot = path.relative(FRONTEND_ROOT, absolutePath);
  const isSensitive = SENSITIVE_FILE_PATTERNS.some(
    pattern => pattern.test(basename) || pattern.test(relativeFromRoot)
  );

  return !isSensitive;
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
  return absolute;
}
