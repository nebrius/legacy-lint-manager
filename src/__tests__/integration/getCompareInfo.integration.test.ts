import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getCompareInfo } from '../../validate/getCompareInfo.js';

// getCompareInfo shells out to git, so each test builds a throwaway repo in a
// temp dir, commits a baseline database on `main`, reads it back via
// getCompareInfo, and removes the dir afterwards. This exercises the real
// `git show` / `git symbolic-ref` plumbing without touching the developer's repo
// or relying on a committed long-lived test branch. The pid keeps parallel
// vitest workers from colliding on the same temp dir.
const REPO_DIR = join(
  tmpdir(),
  `lint-legacies-compare-repo-${process.pid.toString()}`
);
// git show interpolates databaseFile directly, so it must be repo-relative.
const DB_FILE = 'lint-legacies.json';

function git(args: string[]) {
  execFileSync('git', args, { cwd: REPO_DIR, stdio: 'pipe' });
}

// Build a repo on `main` whose committed database holds the given baseline ids,
// then move to a `feature` branch (the working branch getCompareInfo reads from).
function initRepo(baselineIds: string[]) {
  mkdirSync(REPO_DIR, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(REPO_DIR, DB_FILE), JSON.stringify({ ids: baselineIds }));
  git(['add', '-A']);
  git(['commit', '-m', 'baseline']);
  git(['checkout', '-b', 'feature']);
}

// getCompareInfo runs git in process.cwd() and resolves databaseFile relative to
// it, so the call must happen with the temp repo as cwd. Restore in finally so a
// throw doesn't leave the suite pointed at the temp dir.
function runGetCompareInfo(args: Parameters<typeof getCompareInfo>[0]) {
  const originalCwd = process.cwd();
  process.chdir(REPO_DIR);
  try {
    return getCompareInfo(args);
  } finally {
    process.chdir(originalCwd);
  }
}

describe('getCompareInfo (integration)', () => {
  afterEach(() => {
    rmSync(REPO_DIR, { recursive: true, force: true });
  });

  describe('with an explicit compare branch', () => {
    it('reads the expected ids from the compare branch database', () => {
      initRepo(['a', 'b']);

      const info = runGetCompareInfo({
        compareBranch: 'main',
        databaseFile: DB_FILE,
      });

      expect(info.compareBranchName).toBe('main');
      expect(info.expectedIds).toEqual(new Set(['a', 'b']));
    });

    it('returns an empty set when the compare branch database has no ids', () => {
      initRepo([]);

      const info = runGetCompareInfo({
        compareBranch: 'main',
        databaseFile: DB_FILE,
      });

      expect(info.expectedIds).toEqual(new Set());
    });
  });

  describe('with no compare branch (resolves origin/HEAD)', () => {
    // The undefined-branch path runs `git symbolic-ref refs/remotes/origin/HEAD`,
    // which only resolves when the repo has an origin remote with a known HEAD.
    // We give it one by cloning the working repo into a bare repo that acts as
    // origin, wiring it back as the remote, and pointing origin/HEAD at main
    // explicitly (the repo is left on `feature`, so an auto-detected HEAD would
    // resolve to the wrong branch).
    const ORIGIN_DIR = join(
      tmpdir(),
      `lint-legacies-compare-origin-${process.pid.toString()}`
    );

    afterEach(() => {
      rmSync(ORIGIN_DIR, { recursive: true, force: true });
    });

    function addOrigin() {
      execFileSync('git', ['clone', '--bare', REPO_DIR, ORIGIN_DIR], {
        stdio: 'pipe',
      });
      git(['remote', 'add', 'origin', ORIGIN_DIR]);
      git(['fetch', 'origin']);
      git(['remote', 'set-head', 'origin', 'main']);
    }

    it('resolves the default branch and reads its ids', () => {
      initRepo(['a', 'b']);
      addOrigin();

      const info = runGetCompareInfo({
        compareBranch: undefined,
        databaseFile: DB_FILE,
      });

      // The resolved name is stripped of the `origin/` prefix and trimmed.
      expect(info.compareBranchName).toBe('main');
      expect(info.expectedIds).toEqual(new Set(['a', 'b']));
    });
  });
});
