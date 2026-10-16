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
import { FRONTEND_ROOT, BACKEND_ROOT, isPathSafe } from '../config/paths';
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

function isSensitivePath(targetPath: string): boolean {
  const base = path.basename(targetPath).toLowerCase();
  if (base === '.env' || base.startsWith('.env.') || base === '.git') {
    return true;
  }
  const parts = targetPath.split(path.sep).map(p => p.toLowerCase());
  return parts.includes('.git') || parts.includes('node_modules');
}

function validateSinglePath(rawPath: string): string | null {
  if (!rawPath || typeof rawPath !== 'string') return null;
  const absolute = path.resolve(FRONTEND_ROOT, rawPath);
  if (isSensitivePath(absolute)) return null;
  return isPathSafe(absolute) ? absolute : null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Validates the primary `path` field from query or body.
 * Attach to any route that takes a file path as input.
 */
export function validatePath(req: Request, res: Response, next: NextFunction): void {
  // Accept `path` from query params (GET/DELETE) or request body (POST/PUT)
  const rawPath: string | undefined =
    (req.query['path'] as string | undefined) ??
    (req.body as Record<string, unknown>)?.['path'] as string | undefined;

  if (!rawPath) {
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
  const body = req.body as Record<string, unknown>;
  const rawOld = body['oldPath'] as string | undefined;
  const rawNew = body['newPath'] as string | undefined;

  if (!rawOld || !rawNew) {
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
