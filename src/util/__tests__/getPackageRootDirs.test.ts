import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getPackageRootDirs } from '../getPackageRootDirs.js';
import type { ValidationError } from '../types.js';

// Real temp workspaces (no mocking) so the test exercises the actual
// @manypkg/get-packages resolution the tool relies on.
const createdDirs: string[] = [];

// realpathSync so the created path matches what getPackagesSync returns: on
// macOS tmpdir is a symlink, so canonicalizing up front keeps the equality exact.
function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
}

function writePackageJson(
  dir: string,
  contents: Record<string, unknown>
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(contents));
}

// Build a two-package npm workspace and return its root. manypkg only recognizes
// a workspace when a lockfile marker is present; a bare `workspaces` field alone
// falls back to a single root package. An empty npm lockfile is the lightest
// marker that makes it resolve as an npm monorepo. The extra group adds a
// packages-extra/c package so a wildcard ignore can match some packages but not
// all, including a sibling directory that shares the "packages" name prefix.
function makeWorkspace({ extraGroup = false }: { extraGroup?: boolean } = {}) {
  const root = makeTempDir('lint-legacies-workspace-');
  writePackageJson(root, {
    name: 'root',
    version: '1.0.0',
    private: true,
    workspaces: extraGroup
      ? ['packages/*', 'packages-extra/*']
      : ['packages/*'],
  });
  writeFileSync(join(root, 'package-lock.json'), '{}');
  writePackageJson(join(root, 'packages', 'a'), {
    name: 'a',
    version: '1.0.0',
  });
  writePackageJson(join(root, 'packages', 'b'), {
    name: 'b',
    version: '1.0.0',
  });
  if (extraGroup) {
    writePackageJson(join(root, 'packages-extra', 'c'), {
      name: 'c',
      version: '1.0.0',
    });
  }
  return root;
}

// Fills in the object argument, defaulting to no ignored packages and a fresh
// error sink so each call can focus on the inputs it exercises.
function run({
  repoRootDir,
  ignorePackagePaths = [],
  validationErrors = [],
}: {
  repoRootDir: string;
  ignorePackagePaths?: string[];
  validationErrors?: ValidationError[];
}) {
  return getPackageRootDirs({
    repoRootDir,
    monorepoConfig: { ignorePackagePaths },
    validationErrors,
  });
}

afterEach(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  createdDirs.length = 0;
});

describe('getPackageRootDirs', () => {
  it('returns just the root dir for a single (non-workspace) package', () => {
    const dir = makeTempDir('lint-legacies-single-');
    writePackageJson(dir, { name: 'solo', version: '1.0.0' });

    // With no workspace, manypkg resolves the dir itself as the lone package.
    expect(run({ repoRootDir: dir })).toEqual([dir]);
  });

  it('returns each workspace package dir (and not the root) for a monorepo', () => {
    const root = makeWorkspace();

    // The child package dirs are returned; the monorepo root is not one of them.
    expect(run({ repoRootDir: root }).sort()).toEqual(
      [join(root, 'packages', 'a'), join(root, 'packages', 'b')].sort()
    );
  });

  it('omits a package listed in ignorePackagePaths', () => {
    const root = makeWorkspace();
    const validationErrors: ValidationError[] = [];

    const result = run({
      repoRootDir: root,
      ignorePackagePaths: [join(root, 'packages', 'a')],
      validationErrors,
    });

    // Only the un-ignored package survives, and a valid ignore path is not an error.
    expect(result).toEqual([join(root, 'packages', 'b')]);
    expect(validationErrors).toEqual([]);
  });

  it('records a validation error for an ignore path that is not a package', () => {
    const root = makeWorkspace();
    const validationErrors: ValidationError[] = [];

    const result = run({
      repoRootDir: root,
      ignorePackagePaths: [join(root, 'packages', 'nope')],
      validationErrors,
    });

    // The unknown path is reported, and the real packages are still returned.
    expect(validationErrors).toEqual([
      {
        message: `Unknown ignore package path "${join(root, 'packages', 'nope')}"`,
      },
    ]);
    expect(result.sort()).toEqual(
      [join(root, 'packages', 'a'), join(root, 'packages', 'b')].sort()
    );
  });

  it('omits every package under a wildcard ignore path, but not a prefix-sharing sibling', () => {
    const root = makeWorkspace({ extraGroup: true });
    const validationErrors: ValidationError[] = [];

    const result = run({
      repoRootDir: root,
      ignorePackagePaths: [join(root, 'packages', '*')],
      validationErrors,
    });

    // Both packages under packages/ are dropped. packages-extra/c survives even
    // though its directory name starts with "packages": the wildcard only
    // matches past the trailing slash. A matching wildcard is not an error.
    expect(result).toEqual([join(root, 'packages-extra', 'c')]);
    expect(validationErrors).toEqual([]);
  });

  it('records a validation error for a wildcard that matches no packages', () => {
    const root = makeWorkspace();
    const validationErrors: ValidationError[] = [];

    const result = run({
      repoRootDir: root,
      ignorePackagePaths: [join(root, 'nomatch', '*')],
      validationErrors,
    });

    // The unmatched wildcard is reported, and the real packages are still
    // returned.
    expect(validationErrors).toEqual([
      {
        message: `Ignore package path wildcard "${join(root, 'nomatch', '*')}" did not match any packages`,
      },
    ]);
    expect(result.sort()).toEqual(
      [join(root, 'packages', 'a'), join(root, 'packages', 'b')].sort()
    );
  });

  it('applies wildcard and exact ignore paths together', () => {
    const root = makeWorkspace({ extraGroup: true });
    const validationErrors: ValidationError[] = [];

    const result = run({
      repoRootDir: root,
      ignorePackagePaths: [
        join(root, 'packages', '*'),
        join(root, 'packages-extra', 'c'),
      ],
      validationErrors,
    });

    // The wildcard drops a and b, the exact path drops c, and neither ignore is
    // an error.
    expect(result).toEqual([]);
    expect(validationErrors).toEqual([]);
  });

  it('reports only the unknown paths when known and unknown ignores are mixed', () => {
    const root = makeWorkspace();
    const validationErrors: ValidationError[] = [];

    const result = run({
      repoRootDir: root,
      ignorePackagePaths: [
        join(root, 'packages', 'a'),
        join(root, 'packages', 'ghost'),
      ],
      validationErrors,
    });

    // The known ignore is applied (package a dropped); the unknown one is flagged.
    expect(result).toEqual([join(root, 'packages', 'b')]);
    expect(validationErrors).toEqual([
      {
        message: `Unknown ignore package path "${join(root, 'packages', 'ghost')}"`,
      },
    ]);
  });
});
