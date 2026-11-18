/**
 * @file errorHandler.ts
 * @description
 *   Global Express error handler middleware.
 *   All unhandled errors bubble up here and are serialised into the standard
 *   ApiError envelope before being sent to the client.
 *
 *   Usage: app.use(errorHandler) — must be registered LAST, after all routes.
 */

import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../types/api.types';
import { env } from '../config/env';

// ─── Custom App Error ─────────────────────────────────────────────────────────

/** Throw this from any service or controller to surface a structured API error. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Error Handler Middleware ─────────────────────────────────────────────────

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    _next(err);
    return;
  }

  // Determine HTTP status and structured error info
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred.';
  let details: Record<string, string[]> | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code       = err.code;
    message    = err.message;
    details    = err.details;
  } else if (
    err instanceof SyntaxError &&
    'body' in err &&
    (err as { status?: number }).status === 400
  ) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON request body.';
  } else if (err instanceof Error) {
    message = err.message;

    // Path traversal is already caught in validatePath middleware,
    // but handle it here too as a fallback.
    if (message.toLowerCase().includes('path traversal')) {
      statusCode = 403;
      code = 'PATH_TRAVERSAL';
    }
  }

  // In production, don't leak internal details for 5xx errors
  if (env.NODE_ENV === 'production' && statusCode >= 500) {
    message = 'An internal server error occurred.';
    details = undefined;
  }

  // Log to console — in a real system, replace with a logger (e.g. pino, winston)
  if (statusCode >= 500) {
    console.error(`[ERROR] ${code}: ${message}`, err instanceof Error ? err.stack : err);
  }

  const body: ApiError = {
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(body);
}
