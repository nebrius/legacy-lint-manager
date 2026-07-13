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
    expect(getPackageRootDirs(dir)).toEqual([dir]);
  });

  it('returns each workspace package dir (and not the root) for a monorepo', () => {
    const root = makeTempDir('lint-legacies-workspace-');
    // manypkg only recognizes a workspace when a lockfile marker is present; a
    // bare `workspaces` field alone falls back to a single root package. An empty
    // npm lockfile is the lightest marker that makes it resolve as an npm monorepo.
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

    // The child package dirs are returned; the monorepo root is not one of them.
    expect(getPackageRootDirs(root).sort()).toEqual(
      [join(root, 'packages', 'a'), join(root, 'packages', 'b')].sort()
    );
  });
});
