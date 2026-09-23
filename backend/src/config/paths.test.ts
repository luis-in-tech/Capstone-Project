process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.FRONTEND_ROOT = process.env.FRONTEND_ROOT || require('path').resolve(__dirname, '../../../');

import path from 'path';
import { isPathSafe, resolveAndValidate, FRONTEND_ROOT, BACKEND_ROOT } from './paths';

describe('Paths and Security Isolation', () => {
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
});
