const prevDbUrl = process.env.DATABASE_URL;
const prevFrontendRoot = process.env.FRONTEND_ROOT;
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.FRONTEND_ROOT = process.env.FRONTEND_ROOT || require('path').resolve(__dirname, '../../../');

import fs from 'fs';
import path from 'path';
import { isPathSafe, resolveAndValidate, resolveCanonicalPath, FRONTEND_ROOT, BACKEND_ROOT } from './paths';

describe('Paths and Security Isolation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDbUrl;
    if (prevFrontendRoot === undefined) delete process.env.FRONTEND_ROOT;
    else process.env.FRONTEND_ROOT = prevFrontendRoot;
  });
  it('should recognize frontend root as safe', () => {
    expect(isPathSafe(FRONTEND_ROOT)).toBe(true);
  });

  it('should recognize files inside frontend as safe', () => {
    const filePath = path.join(FRONTEND_ROOT, 'src', 'App.tsx');
    expect(isPathSafe(filePath)).toBe(true);
  });

  it('should block paths inside backend root', () => {
    expect(isPathSafe(BACKEND_ROOT)).toBe(false);
    const backendFile = path.join(BACKEND_ROOT, 'src', 'server.ts');
    expect(isPathSafe(backendFile)).toBe(false);
  });

  it('should block traversal escaping frontend root', () => {
    expect(() => {
      resolveAndValidate('../../../etc/passwd');
    }).toThrow('Path traversal detected');
  });

  it('should safely resolve and return valid frontend relative paths', () => {
    const resolved = resolveAndValidate('src/App.tsx');
    expect(resolved).toBe(path.resolve(FRONTEND_ROOT, 'src/App.tsx'));
  });

  it('should block access to .env files inside frontend root', () => {
    const envPath = path.join(FRONTEND_ROOT, '.env');
    expect(isPathSafe(envPath)).toBe(false);
  });

  it('should block access to .env.local files', () => {
    const envPath = path.join(FRONTEND_ROOT, '.env.local');
    expect(isPathSafe(envPath)).toBe(false);
  });

  it('should block access to .git directory', () => {
    const gitPath = path.join(FRONTEND_ROOT, '.git', 'config');
    expect(isPathSafe(gitPath)).toBe(false);
  });

  it('should block nested .git, config.toml, Windows ADS streams, trailing dots/spaces, and control chars', () => {
    expect(isPathSafe(path.join(FRONTEND_ROOT, 'packages', 'sub', '.git', 'config'))).toBe(false);
    expect(isPathSafe(path.join(FRONTEND_ROOT, 'supabase', 'config.toml'))).toBe(false);
    expect(isPathSafe(path.join(FRONTEND_ROOT, '.env.'))).toBe(false);
    expect(isPathSafe(path.join(FRONTEND_ROOT, '.env '))).toBe(false);
    expect(isPathSafe(path.join(FRONTEND_ROOT, '.env::$DATA'))).toBe(false);
    expect(isPathSafe(path.join(FRONTEND_ROOT, 'src', 'App.tsx:stream'))).toBe(false);
    expect(isPathSafe(path.join(FRONTEND_ROOT, 'src', 'bad\nfile.ts'))).toBe(false);
  });

  it('should fail closed on symlink escape, dangling symlinks, and ELOOP errors', () => {
    const linkCandidate = path.join(FRONTEND_ROOT, 'src', 'escaped-link.ts');
    const origLstat = fs.lstatSync;
    const origRealpath = fs.realpathSync;

    jest.spyOn(fs, 'lstatSync').mockImplementation((p: any, opts?: any) => {
      if (String(p) === linkCandidate) {
        return { isSymbolicLink: () => true } as unknown as fs.Stats;
      }
      return origLstat(p, opts);
    });
    jest.spyOn(fs, 'realpathSync').mockImplementation(((p: any) => {
      if (String(p) === linkCandidate) {
        const err: any = new Error('ENOENT: dangling symlink');
        err.code = 'ENOENT';
        throw err;
      }
      return origRealpath(p);
    }) as any);

    expect(() => resolveCanonicalPath(linkCandidate)).toThrow();
    expect(isPathSafe(linkCandidate)).toBe(false);
  });
});
