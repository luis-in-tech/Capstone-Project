/**
 * @file rbac.middleware.ts
 * @description Restrictive Role-Based Access Control (RBAC) middleware (FR-07, NFR-04).
 *
 * Rules:
 *   - Full administrative control: 'cmo', 'admin'
 *   - Office Staff ('secretary'): Can read finances & create transactions, but CANNOT edit or delete financial records.
 *   - Field Agents ('field_agent'): Completely REVOKED from financial modules and automated reporting.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import crypto from 'crypto';
import { env } from '../config/env';

export type UserRole = 'cmo' | 'admin' | 'secretary' | 'field_agent';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      userRole?: UserRole;
      currentUser?: AuthenticatedUser;
    }
  }
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  return match?.[1]?.trim() || undefined;
}

function secretsMatchConstantTime(provided: string, expected: string): boolean {
  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

const ELEVATED_ROLES: ReadonlySet<UserRole> = new Set(['cmo', 'admin', 'secretary']);

const ROLE_SECRET_ENV_KEYS: Record<Exclude<UserRole, 'field_agent'>, string> = {
  admin: 'API_SECRET_ADMIN',
  cmo: 'API_SECRET_CMO',
  secretary: 'API_SECRET_SECRETARY',
};

function getExpectedSecretForRole(role: Exclude<UserRole, 'field_agent'>): string | undefined {
  const roleSpecific = process.env[ROLE_SECRET_ENV_KEYS[role]]?.trim();
  if (roleSpecific) return roleSpecific;
  return env.API_SECRET?.trim() || undefined;
}

/**
 * Resolves an authenticated user role from HTTP/WebSocket request headers.
 * Always fails closed to `'field_agent'` when credentials are missing or invalid.
 */
export function resolveUserRoleFromHeaders(
  headers: Record<string, string | string[] | undefined>
): UserRole {
  const providedSecret =
    readSingleHeader(headers['x-api-key']) ??
    readSingleHeader(headers['x-api-secret']) ??
    extractBearerToken(readSingleHeader(headers['authorization']));

  const headerRole = readSingleHeader(headers['x-user-role']);
  if (headerRole) {
    const normalized = headerRole.toLowerCase() as UserRole;
    if (ELEVATED_ROLES.has(normalized)) {
      const elevated = normalized as Exclude<UserRole, 'field_agent'>;
      const expectedSecret = getExpectedSecretForRole(elevated);
      if (expectedSecret && providedSecret && secretsMatchConstantTime(providedSecret, expectedSecret)) {
        return elevated;
      }
      // Elevation secret missing or invalid; fail closed to least-privileged role
      return 'field_agent';
    }
    if (normalized === 'field_agent') {
      return 'field_agent';
    }
  }

  return 'field_agent';
}

/**
 * Extracts and sets the user role from request headers.
 * Privilege elevation to 'cmo', 'admin', or 'secretary' ALWAYS requires a configured
 * non-empty role secret (API_SECRET_<ROLE> or fallback API_SECRET) and a matching token.
 */
export function extractUserRole(req: Request, _res: Response, next: NextFunction): void {
  req.userRole = resolveUserRoleFromHeaders(req.headers);
  next();
}

/**
 * Ensures the requesting client has one of the allowed roles.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const currentRole = req.userRole || 'field_agent';

    if (!allowedRoles.includes(currentRole)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        `Access denied. Role "${currentRole}" is not authorized for this resource.`
      );
    }

    next();
  };
}

/**
 * Financial Module Guard (FR-07):
 * - Field Agents are completely revoked (403).
 * - Secretaries cannot execute destructive methods (PUT, PATCH, DELETE).
 */
export function financeGuard(req: Request, _res: Response, next: NextFunction): void {
  const currentRole = req.userRole || 'field_agent';

  if (currentRole === 'field_agent') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Field Agents are strictly revoked from accessing financial modules and automated reporting.'
    );
  }

  if (currentRole === 'secretary' && ['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Office Staff (Secretaries) are restricted from editing or deleting financial records.'
    );
  }

  next();
}
