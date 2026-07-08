import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getFileList,
  getRepoRoot,
  getUnprefixedRelativeDir,
} from '../files.js';

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

describe('getRepoRoot', () => {
  // Each case builds a throwaway tree under the system temp dir (which is not a
  // git repo), seeding an empty .git directory to mark the repo root. getRepoRoot
  // only checks for a `.git` entry on disk, so it doesn't need a real git repo.
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'legacy-lint-reporoot-'));
    mkdirSync(join(repoDir, '.git'));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns the directory itself when it contains a .git directory', () => {
    expect(getRepoRoot(repoDir)).toBe(repoDir);
  });

  it('walks up from a nested subdirectory to the repo root', () => {
    const nested = join(repoDir, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    expect(getRepoRoot(nested)).toBe(repoDir);
  });

  it('resolves from the containing directory when given a file path', () => {
    const file = join(repoDir, 'src', 'index.ts');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
    expect(getRepoRoot(file)).toBe(repoDir);
  });

  it('throws when no .git exists up to the filesystem root', () => {
    // A temp dir with no seeded .git, and no .git anywhere up to `/`.
    const noRepo = mkdtempSync(join(tmpdir(), 'legacy-lint-norepo-'));
    try {
      expect(() => getRepoRoot(noRepo)).toThrow(
        'Could not determine repo root'
      );
    } finally {
      rmSync(noRepo, { recursive: true, force: true });
    }
  });
});

describe('getUnprefixedRelativeDir', () => {
  it('returns the repo-relative path (no leading ./) for an absolute path under rootDir', () => {
    expect(
      getUnprefixedRelativeDir({ path: '/repo/src/foo.ts', rootDir: '/repo' })
    ).toBe('src/foo.ts');
  });

  it('returns a bare filename for a file directly inside rootDir', () => {
    expect(
      getUnprefixedRelativeDir({ path: '/repo/foo.ts', rootDir: '/repo' })
    ).toBe('foo.ts');
  });

  it('throws when the path is not absolute', () => {
    expect(() =>
      getUnprefixedRelativeDir({ path: 'src/foo.ts', rootDir: '/repo' })
    ).toThrow('to be an absolute path');
  });

  it('throws when the path is absolute but not under rootDir', () => {
    expect(() =>
      getUnprefixedRelativeDir({ path: '/other/foo.ts', rootDir: '/repo' })
    ).toThrow('to start with');
  });

  it('throws when rootDir is a string prefix but not a path-boundary ancestor', () => {
    // '/repo-other' starts with the string '/repo' but is not under it as a path
    // segment; the `rootDir + sep` guard must reject it rather than slice into
    // the middle of a directory name.
    expect(() =>
      getUnprefixedRelativeDir({ path: '/repo-other/foo.ts', rootDir: '/repo' })
    ).toThrow('to start with');
  });
});
