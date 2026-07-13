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
// marker that makes it resolve as an npm monorepo.
function makeWorkspace(): string {
  const root = makeTempDir('lint-legacies-workspace-');
  writePackageJson(root, {
    name: 'root',
    version: '1.0.0',
    private: true,
    workspaces: ['packages/*'],
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
