/**
 * @file validatePath.test.ts
 * @description Tests for path traversal, null-byte, array smuggling, and symlink containment guards.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { validatePath, validateRenamePaths } from './validatePath';
import { FRONTEND_ROOT, isPathSafe, resolveCanonicalPath } from '../config/paths';

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

describe('Path Traversal & Symlink Containment Guards', () => {
  it('blocks traversal, null bytes, empty/root targets, and sensitive files', () => {
    const cases: Array<Partial<Request>> = [
      { query: { path: '../../etc/passwd' }, body: {} },
      { query: { path: 'src/App.tsx\0.png' }, body: {} },
      { query: { path: '.' }, body: {} },
      { query: { path: '.env' }, body: {} },
      { query: { path: '.git/config' }, body: {} },
      { query: { path: 'nested/.git/HEAD' }, body: {} },
      { query: { path: 'supabase/config.toml' }, body: {} },
      { query: { path: 'src/App.tsx::$DATA' }, body: {} },
      { query: { path: '.env ' }, body: {} },
    ];

    for (const reqShape of cases) {
      const res = mockRes();
      const next: NextFunction = jest.fn();
      validatePath(reqShape as Request, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });

  it('returns 400 when path is missing, array-smuggled, or non-string on rename', () => {
    const res1 = mockRes();
    const next1: NextFunction = jest.fn();
    validatePath({ query: {}, body: {} } as unknown as Request, res1, next1);
    expect(res1.status).toHaveBeenCalledWith(400);

    const resArr = mockRes();
    const nextArr: NextFunction = jest.fn();
    validatePath({ query: { path: ['src/a.ts', 'src/b.ts'] as unknown as string }, body: {} } as unknown as Request, resArr, nextArr);
    expect(nextArr).not.toHaveBeenCalled();
    expect(resArr.status).toHaveBeenCalledWith(400);

    const res2 = mockRes();
    const next2: NextFunction = jest.fn();
    validateRenamePaths({ body: undefined } as unknown as Request, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it('allows valid non-sensitive paths within FRONTEND_ROOT', () => {
    const res = mockRes();
    const next: NextFunction = jest.fn();
    const req = { query: { path: 'src/App.tsx' }, body: {} } as unknown as Request;
    validatePath(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.safePath).toBe(path.resolve(FRONTEND_ROOT, 'src/App.tsx'));
  });

  it('resolves non-existent children against existing parent symlinks cleanly', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-outside-'));
    try {
      const canonicalOutside = resolveCanonicalPath(path.join(outsideDir, 'nested/file.txt'));
      expect(canonicalOutside.endsWith(path.join('nested', 'file.txt'))).toBe(true);
      expect(isPathSafe(canonicalOutside)).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('blocks requests targeting symlinks escaping workspace or dangling symlinks', () => {
    const escapedTarget = path.resolve(FRONTEND_ROOT, 'src', 'symlinked.ts');
    const origLstat = fs.lstatSync;
    const origRealpath = fs.realpathSync;

    jest.spyOn(fs, 'lstatSync').mockImplementation((p: any, opts?: any) => {
      if (String(p) === escapedTarget) {
        return { isSymbolicLink: () => true } as unknown as fs.Stats;
      }
      return origLstat(p, opts);
    });
    jest.spyOn(fs, 'realpathSync').mockImplementation(((p: any) => {
      if (String(p) === escapedTarget) {
        return path.resolve(os.tmpdir(), 'outside-secret.ts');
      }
      return origRealpath(p);
    }) as any);

    try {
      const res = mockRes();
      const next: NextFunction = jest.fn();
      validatePath({ query: { path: 'src/symlinked.ts' }, body: {} } as unknown as Request, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
