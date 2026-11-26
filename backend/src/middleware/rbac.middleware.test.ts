/**
 * @file rbac.middleware.test.ts
 * @description Security regression tests for RBAC role extraction & route guards.
 */

import { Request, Response, NextFunction } from 'express';
import { extractUserRole, requireRole, financeGuard } from './rbac.middleware';
import { env } from '../config/env';

function makeReq(headers: Record<string, string | string[]>, method = 'GET'): Request {
  const normalized: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }
  return { headers: normalized, method } as unknown as Request;
}

function runExtract(headers: Record<string, string | string[]>): string | undefined {
  const req = makeReq(headers);
  const next: NextFunction = jest.fn();
  extractUserRole(req, {} as Response, next);
  return req.userRole;
}

describe('RBAC Middleware Security Hardening', () => {
  const originalSecret = env.API_SECRET;

  afterEach(() => {
    (env as { API_SECRET?: string }).API_SECRET = originalSecret;
  });

  it('fails closed when API_SECRET is unset — never elevates admin, cmo, or secretary', () => {
    (env as { API_SECRET?: string }).API_SECRET = undefined;

    expect(runExtract({ 'x-user-role': 'admin' })).toBe('field_agent');
    expect(runExtract({ 'x-user-role': 'cmo' })).toBe('field_agent');
    expect(runExtract({ 'x-user-role': 'secretary' })).toBe('field_agent');
  });

  it('rejects unauthenticated or wrong-secret elevation including secretary', () => {
    (env as { API_SECRET?: string }).API_SECRET = 'super-secret-token-value';

    expect(runExtract({ 'x-user-role': 'secretary' })).toBe('field_agent');
    expect(runExtract({ 'x-user-role': 'secretary', 'x-api-key': 'wrong' })).toBe('field_agent');
    expect(runExtract({ 'x-user-role': 'admin', authorization: 'Bearer wrong' })).toBe('field_agent');
    expect(runExtract({ 'x-user-role': 'cmo', 'x-api-secret': ['a', 'b'] })).toBe('field_agent');
  });

  it('elevates admin, cmo, and secretary with valid x-api-key, x-api-secret, or Bearer token', () => {
    (env as { API_SECRET?: string }).API_SECRET = 'super-secret-token-value';

    expect(runExtract({ 'x-user-role': 'secretary', 'x-api-key': 'super-secret-token-value' })).toBe('secretary');
    expect(runExtract({ 'x-user-role': 'admin', 'x-api-secret': 'super-secret-token-value' })).toBe('admin');
    expect(runExtract({ 'x-user-role': 'CMO', authorization: 'Bearer super-secret-token-value' })).toBe('cmo');
  });

  it('enforces requireRole and financeGuard boundaries', () => {
    const opsGuard = requireRole(['admin', 'cmo', 'secretary']);
    const next = jest.fn();

    expect(() => opsGuard(makeReq({}) as Request, {} as Response, next)).toThrow();
    expect(next).not.toHaveBeenCalled();

    expect(() => financeGuard(Object.assign(makeReq({}, 'GET'), { userRole: 'field_agent' as const }), {} as Response, next)).toThrow();
    expect(() => financeGuard(Object.assign(makeReq({}, 'DELETE'), { userRole: 'secretary' as const }), {} as Response, next)).toThrow();
  });

  it('prevents cross-role privilege escalation when per-role secrets are configured', () => {
    const prevAdminSecret = process.env['API_SECRET_ADMIN'];
    const prevSecretarySecret = process.env['API_SECRET_SECRETARY'];
    process.env['API_SECRET_ADMIN'] = 'admin-only-secret-123456';
    process.env['API_SECRET_SECRETARY'] = 'secretary-only-secret-123';
    (env as { API_SECRET?: string }).API_SECRET = 'shared-fallback-secret';

    try {
      expect(runExtract({ 'x-user-role': 'admin', 'x-api-key': 'secretary-only-secret-123' })).toBe('field_agent');
      expect(runExtract({ 'x-user-role': 'admin', 'x-api-key': 'shared-fallback-secret' })).toBe('field_agent');
      expect(runExtract({ 'x-user-role': 'admin', 'x-api-key': 'admin-only-secret-123456' })).toBe('admin');
      expect(runExtract({ 'x-user-role': 'secretary', 'x-api-key': 'secretary-only-secret-123' })).toBe('secretary');
    } finally {
      if (prevAdminSecret === undefined) delete process.env['API_SECRET_ADMIN'];
      else process.env['API_SECRET_ADMIN'] = prevAdminSecret;
      if (prevSecretarySecret === undefined) delete process.env['API_SECRET_SECRETARY'];
      else process.env['API_SECRET_SECRETARY'] = prevSecretarySecret;
    }
  });
});
