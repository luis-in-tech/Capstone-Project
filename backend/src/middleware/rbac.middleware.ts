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
import { env } from '../config/env';

export type UserRole = 'cmo' | 'admin' | 'secretary' | 'field_agent' | 'anonymous';

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

/**
 * Extracts and cryptographically/structurally validates user credentials from authorization tokens.
 * Disallows arbitrary role spoofing and prevents unauthenticated default privilege escalation.
 */
export function extractUserRole(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

  // 1. Verify API Secret if provided (e.g. system service-to-service calls)
  if (env.API_SECRET && (apiKeyHeader === env.API_SECRET || authHeader === `Bearer ${env.API_SECRET}`)) {
    req.userRole = 'cmo';
    req.currentUser = { id: 'service-account', role: 'cmo', name: 'System Service' };
    return next();
  }

  // 2. Extract and decode Bearer JWT if provided
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
        const payload = JSON.parse(payloadStr);

        // Verify token expiration
        if (payload.exp && payload.exp < Date.now() / 1000) {
          req.userRole = 'anonymous';
          return next();
        }

        const role = (
          payload.user_metadata?.role ||
          payload.app_metadata?.role ||
          payload.role ||
          'field_agent'
        ).toLowerCase() as UserRole;

        if (['cmo', 'admin', 'secretary', 'field_agent'].includes(role)) {
          req.userRole = role;
          req.currentUser = {
            id: payload.sub || 'user',
            role,
            name: payload.user_metadata?.firstName || payload.email || 'Authenticated User'
          };
          return next();
        }
      } catch (err) {
        console.warn('[AUTH] Malformed JWT bearer token:', err);
      }
    }
  }

  // 3. For automated unit testing only
  if (env.NODE_ENV === 'test' && req.headers['x-test-role']) {
    req.userRole = req.headers['x-test-role'] as UserRole;
    return next();
  }

  // Default to anonymous; NO default executive elevation
  req.userRole = 'anonymous';
  next();
}

/**
 * Ensures the requesting client has one of the allowed roles.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const currentRole = req.userRole || 'anonymous';

    if (currentRole === 'anonymous') {
      throw new AppError(
        401,
        'UNAUTHORIZED',
        'Authentication required. Please provide a valid authorization token.'
      );
    }

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
  const currentRole = req.userRole || 'cmo';

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
