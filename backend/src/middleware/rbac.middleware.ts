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

/**
 * Extracts and sets the user role from request headers or auth payload.
 * When API_SECRET is configured in environment, privilege elevation to 'admin' or 'cmo'
 * requires a matching 'x-api-key' or 'x-api-secret' header.
 */
export function extractUserRole(req: Request, _res: Response, next: NextFunction): void {
  const apiSecret = env.API_SECRET;
  const providedSecret = (req.headers['x-api-key'] || req.headers['x-api-secret'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '')) as string | undefined;

  const headerRole = req.headers['x-user-role'] as string | undefined;
  if (headerRole) {
    const normalized = headerRole.toLowerCase().trim() as UserRole;
    if (['cmo', 'admin', 'secretary', 'field_agent'].includes(normalized)) {
      if (apiSecret && (normalized === 'admin' || normalized === 'cmo')) {
        if (providedSecret === apiSecret) {
          req.userRole = normalized;
          return next();
        }
        // Elevation secret rejected; keep as least-privileged field_agent
        req.userRole = 'field_agent';
        return next();
      }
      req.userRole = normalized;
      return next();
    }
  }

  // Fallback to least-privileged role when no valid role header is provided (NFR-04 security hardening)
  req.userRole = 'field_agent';
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
