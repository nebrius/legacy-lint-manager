import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getFileList } from '../files.js';

const PROJECT_ROOT = join(import.meta.dirname, 'project');

function list(scenario: string): string[] {
  return getFileList(join(PROJECT_ROOT, scenario)).sort();
}

function expected(scenario: string, relativePaths: string[]): string[] {
  return relativePaths.map((p) => join(PROJECT_ROOT, scenario, p)).sort();
}

describe('getFileList', () => {
  it('returns only files with recognized code extensions', () => {
    expect(list('mixed-extensions')).toEqual(
      expected('mixed-extensions', [
        'a.ts',
        'b.tsx',
        'c.cts',
        'd.mts',
        'e.js',
        'f.jsx',
        'g.cjs',
        'h.mjs',
      ])
    );
  });

  it('recurses into nested subdirectories', () => {
    expect(list('nested')).toEqual(
      expected('nested', ['top.ts', 'sub/inner.ts', 'sub/deep/deepest.ts'])
    );
  });

  it('excludes default-ignored directories such as build', () => {
    expect(list('ignored-directories')).toEqual(
      expected('ignored-directories', ['keep.ts'])
    );
  });

  it('excludes files matched by a .gitignore', () => {
    expect(list('gitignored')).toEqual(expected('gitignored', ['kept.ts']));
  });
});
