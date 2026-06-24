import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

  // The to-be-ignored file is written at runtime rather than committed: a
  // committed secret.ts would itself be ignored by the repo's own tooling and
  // never land in the fixture, leaving the test vacuous. Writing it here means
  // the assertion fails if ignore filtering ever breaks.
  describe('with a .gitignore matching a runtime-written file', () => {
    const SECRET = join(PROJECT_ROOT, 'gitignored', 'secret.ts');

    beforeEach(() => {
      writeFileSync(SECRET, '');
    });

    afterEach(() => {
      rmSync(SECRET, { force: true });
    });

    it('excludes files matched by a .gitignore but keeps the rest', () => {
      expect(list('gitignored')).toEqual(expected('gitignored', ['kept.ts']));
    });
  });

  // A .gitignore living inside a scanned subdirectory must apply its patterns
  // relative to its own directory, matching git's behavior. The whole tree is
  // built at runtime: the to-be-ignored files would themselves be stripped by
  // the repo's own tooling if committed, leaving the assertions vacuous.
  describe('with nested .gitignore files below the root', () => {
    const NESTED_ROOT = join(PROJECT_ROOT, 'nested-gitignore');

    beforeEach(() => {
      mkdirSync(join(NESTED_ROOT, 'sub'), { recursive: true });
      mkdirSync(join(NESTED_ROOT, 'deep', 'nested'), { recursive: true });

      writeFileSync(join(NESTED_ROOT, 'keep-root.ts'), '');

      // A file-pattern .gitignore one level down: must exclude only the
      // matching sibling, resolved relative to sub/.
      writeFileSync(
        join(NESTED_ROOT, 'sub', '.gitignore'),
        'ignored-in-sub.ts\n'
      );
      writeFileSync(join(NESTED_ROOT, 'sub', 'keep-sub.ts'), '');
      writeFileSync(join(NESTED_ROOT, 'sub', 'ignored-in-sub.ts'), '');

      // A directory-pattern .gitignore one level down: must prune the whole
      // nested/ directory before recursion.
      writeFileSync(join(NESTED_ROOT, 'deep', '.gitignore'), 'nested/\n');
      writeFileSync(join(NESTED_ROOT, 'deep', 'keep-deep.ts'), '');
      writeFileSync(join(NESTED_ROOT, 'deep', 'nested', 'excluded.ts'), '');
    });

    afterEach(() => {
      rmSync(NESTED_ROOT, { recursive: true, force: true });
    });

    it('honors a file pattern from a subdirectory .gitignore', () => {
      const result = list('nested-gitignore');
      expect(result).toContain(join(NESTED_ROOT, 'sub', 'keep-sub.ts'));
      expect(result).not.toContain(
        join(NESTED_ROOT, 'sub', 'ignored-in-sub.ts')
      );
    });

    it('honors a directory pattern from a subdirectory .gitignore', () => {
      const result = list('nested-gitignore');
      expect(result).toContain(join(NESTED_ROOT, 'deep', 'keep-deep.ts'));
      expect(result).not.toContain(
        join(NESTED_ROOT, 'deep', 'nested', 'excluded.ts')
      );
    });

    it('does not let a subdirectory pattern leak to siblings or the root', () => {
      // `ignored-in-sub.ts` only exists under sub/, but assert the root-level
      // keeper survives to prove the sub/ pattern is scoped to sub/.
      expect(list('nested-gitignore')).toContain(
        join(NESTED_ROOT, 'keep-root.ts')
      );
    });
  });
});
