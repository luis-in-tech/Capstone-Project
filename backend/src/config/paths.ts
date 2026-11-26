/**
 * @file paths.ts
 * @description Resolves and exports all critical filesystem paths used by the backend.
 *
 * Key safety invariant:
 *   FRONTEND_ROOT  = the single directory the agent may operate inside.
 *   BACKEND_ROOT   = the backend/ directory itself — always EXCLUDED from agent access.
 *   TRASH_DIR      = backend/.trash/ — where all backups live before restore.
 */

import fs from 'fs';
import path from 'path';
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
  /^\.env(\..+)?$/i,     // .env, .env.local, .env.production, etc.
  /^\.git$/i,            // .git directory and contents anywhere in tree
  /\.pem$/i,             // TLS/SSH private keys
  /\.key$/i,             // Private key files
  /^config\.toml$/i,     // Supabase config anywhere in tree
];

/**
 * Returns true if the given absolute path is safely within FRONTEND_ROOT,
 * does NOT enter BACKEND_ROOT, and does NOT target a sensitive file.
 *
 * This is the core path-traversal and secrets-exposure safety check.
 *
 * @param absolutePath - The resolved absolute path to validate.
 */
/**
 * Resolves the canonical real path even when leaf segments do not yet exist on disk,
 * so symlinks anywhere in an existing parent directory cannot escape allowed roots.
 */
export function resolveCanonicalPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  const missingSegments: string[] = [];
  let cursor = resolved;

  while (true) {
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || missingSegments.length === 0) {
        const real = fs.realpathSync(cursor);
        return missingSegments.length > 0 ? path.join(real, ...missingSegments) : real;
      }
      const real = fs.realpathSync(cursor);
      return missingSegments.length > 0 ? path.join(real, ...missingSegments) : real;
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        // Fail closed if cursor itself exists as a dangling symlink whose target does not exist
        let cursorExistsAsSymlink = false;
        try {
          cursorExistsAsSymlink = fs.lstatSync(cursor).isSymbolicLink();
        } catch {
          cursorExistsAsSymlink = false;
        }
        if (cursorExistsAsSymlink) {
          throw new Error(`Dangling symbolic link cannot be resolved safely: "${cursor}"`);
        }

        const parent = path.dirname(cursor);
        if (parent === cursor) return resolved;
        missingSegments.unshift(path.basename(cursor));
        cursor = parent;
        continue;
      }
      // Broken symlink loop (ELOOP), unreadable target (EACCES), etc.: fail closed
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

export function isSubPath(parentDir: string, candidatePath: string): boolean {
  const normParent = process.platform === 'win32' ? parentDir.toLowerCase() : parentDir;
  const normCandidate = process.platform === 'win32' ? candidatePath.toLowerCase() : candidatePath;
  const rel = path.relative(normParent, normCandidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isPathSafe(absolutePath: string): boolean {
  if (!absolutePath || /[\x00-\x1f]/.test(absolutePath)) {
    return false;
  }

  let normalised: string;
  let canonicalTarget: string;
  let canonicalFrontend: string;
  let canonicalBackend: string;
  try {
    normalised = path.normalize(absolutePath);
    canonicalTarget = resolveCanonicalPath(normalised);
    canonicalFrontend = resolveCanonicalPath(FRONTEND_ROOT);
    canonicalBackend = resolveCanonicalPath(BACKEND_ROOT);
  } catch {
    return false;
  }

  // Check both lexical and canonical (symlink-resolved) boundaries
  const isInsideFrontendLex = isSubPath(FRONTEND_ROOT, normalised);
  const isInsideFrontendReal = isSubPath(canonicalFrontend, canonicalTarget);
  const isInsideBackendLex = isSubPath(BACKEND_ROOT, normalised);
  const isInsideBackendReal = isSubPath(canonicalBackend, canonicalTarget);

  if (!isInsideFrontendLex || !isInsideFrontendReal || isInsideBackendLex || isInsideBackendReal) {
    return false;
  }

  // Block sensitive files, Windows ADS colons, trailing dots/spaces, and nested .git / config.toml
  for (const [rootBase, targetToCheck] of [
    [FRONTEND_ROOT, normalised],
    [canonicalFrontend, canonicalTarget],
  ] as const) {
    const relative = path.relative(rootBase, targetToCheck);
    if (/[\x00-\x1f:]/.test(relative)) {
      return false;
    }
    const segments = relative.split(/[\\/]+/).filter(Boolean);
    for (const seg of segments) {
      const noAds = seg.split(':')[0];
      const noTrailing = noAds.replace(/[. ]+$/, '');
      if (
        SENSITIVE_FILE_PATTERNS.some(
          (pattern) => pattern.test(seg) || pattern.test(noAds) || pattern.test(noTrailing)
        )
      ) {
        return false;
      }
    }
  }

  return true;
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
