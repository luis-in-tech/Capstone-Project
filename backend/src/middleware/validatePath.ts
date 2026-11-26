/**
 * @file validatePath.ts
 * @description
 *   Express middleware that guards EVERY file-operation route against
 *   directory traversal attacks (e.g. "../../etc/passwd").
 *
 *   How it works:
 *     1. Extracts the `path` field from the request body OR query string.
 *     2. Resolves it to an absolute path using path.resolve().
 *     3. Asserts the resolved path starts with FRONTEND_ROOT.
 *     4. Asserts the resolved path does NOT enter BACKEND_ROOT.
 *     5. Attaches the validated absolute path to `req.safePath` for controllers.
 *
 *   If any check fails → 403 Forbidden, no further handlers are called.
 */

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { FRONTEND_ROOT, BACKEND_ROOT, isPathSafe, resolveCanonicalPath } from '../config/paths';
import { ApiError } from '../types/api.types';

// Extend Express Request to carry the validated absolute path
declare global {
  namespace Express {
    interface Request {
      /** Resolved, safety-validated absolute path. Set by validatePath middleware. */
      safePath?: string;
      /** For RENAME operations: the resolved absolute new path. */
      safeNewPath?: string;
    }
  }
}

// ─── Guard Helper ─────────────────────────────────────────────────────────────

function buildForbiddenResponse(detail: string): ApiError {
  return {
    success: false,
    error: {
      code: 'PATH_TRAVERSAL',
      message: `Forbidden: ${detail}`,
    },
    timestamp: new Date().toISOString(),
  };
}

function validateSinglePath(rawPath: string): string | null {
  if (!rawPath || typeof rawPath !== 'string' || /[\x00-\x1f]/.test(rawPath)) return null;
  const absolute = path.resolve(FRONTEND_ROOT, rawPath);
  const relFromRoot = path.relative(FRONTEND_ROOT, absolute);
  if (relFromRoot.includes(':')) return null;
  if (!isPathSafe(absolute)) return null;
  // Never permit file endpoints (read/write/mkdir/rename/delete) to operate on FRONTEND_ROOT itself
  let canonicalTarget: string;
  try {
    canonicalTarget = resolveCanonicalPath(absolute);
  } catch {
    return null;
  }
  const canonicalRoot = resolveCanonicalPath(FRONTEND_ROOT);
  const isRoot =
    process.platform === 'win32'
      ? canonicalTarget.toLowerCase() === canonicalRoot.toLowerCase()
      : canonicalTarget === canonicalRoot;
  if (isRoot) return null;
  return absolute;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Validates the primary `path` field from query or body.
 * Attach to any route that takes a file path as input.
 */
export function validatePath(req: Request, res: Response, next: NextFunction): void {
  // Accept `path` from query params (GET/DELETE) or request body (POST/PUT)
  const rawQueryPath = req.query['path'];
  const rawBodyPath = (req.body as Record<string, unknown> | undefined)?.['path'];
  const rawPath: unknown = rawQueryPath !== undefined ? rawQueryPath : rawBodyPath;

  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    res.status(400).json({
      success: false,
      error: { code: 'MISSING_PATH', message: 'A "path" parameter is required.' },
      timestamp: new Date().toISOString(),
    } satisfies ApiError);
    return;
  }

  const safePath = validateSinglePath(rawPath);

  if (!safePath) {
    console.warn(
      `[SECURITY] Path traversal blocked: "${rawPath}" (FRONTEND_ROOT=${FRONTEND_ROOT}, BACKEND_ROOT=${BACKEND_ROOT})`
    );
    res.status(403).json(
      buildForbiddenResponse(`The path "${rawPath}" is outside the allowed workspace directory.`)
    );
    return;
  }

  req.safePath = safePath;
  next();
}

/**
 * Validates BOTH `oldPath` and `newPath` fields for rename operations.
 * Attaches safePath (old) and safeNewPath (new) to the request.
 */
export function validateRenamePaths(req: Request, res: Response, next: NextFunction): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawOld = body['oldPath'];
  const rawNew = body['newPath'];

  if (typeof rawOld !== 'string' || typeof rawNew !== 'string' || !rawOld || !rawNew) {
    res.status(400).json({
      success: false,
      error: { code: 'MISSING_PATHS', message: 'Both "oldPath" and "newPath" are required.' },
      timestamp: new Date().toISOString(),
    } satisfies ApiError);
    return;
  }

  const safeOld = validateSinglePath(rawOld);
  const safeNew = validateSinglePath(rawNew);

  if (!safeOld || !safeNew) {
    const offender = !safeOld ? rawOld : rawNew;
    console.warn(`[SECURITY] Path traversal blocked in rename: "${offender}"`);
    res.status(403).json(
      buildForbiddenResponse(`The path "${offender}" is outside the allowed workspace directory.`)
    );
    return;
  }

  req.safePath    = safeOld;
  req.safeNewPath = safeNew;
  next();
}
