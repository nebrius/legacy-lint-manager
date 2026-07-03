import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getCompareInfo } from '../../validate/getCompareInfo.js';

// getCompareInfo shells out to git, so each test builds a throwaway repo in a
// temp dir, commits a baseline database on `main`, reads it back via
// getCompareInfo, and removes the dir afterwards. This exercises the real
// `git show` plumbing without touching the developer's repo or relying on a
// committed long-lived test branch. The pid keeps parallel vitest workers from
// colliding on the same temp dir.
const REPO_DIR = join(
  tmpdir(),
  `lint-legacies-compare-repo-${process.pid.toString()}`
);
// git show interpolates databaseFile directly, so it must be repo-relative.
const DB_FILE = 'legacy-lint.data.json';

function git(args: string[]) {
  execFileSync('git', args, { cwd: REPO_DIR, stdio: 'pipe' });
}

// Build a repo on `main` whose committed database holds the given baseline
// entries, then move to a `feature` branch (the working branch getCompareInfo
// reads from).
function initRepo(baseline: [string, string[]][]) {
  mkdirSync(REPO_DIR, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  // The data file is an array of [id, rules] tuples.
  writeFileSync(join(REPO_DIR, DB_FILE), JSON.stringify(baseline));
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

  it('reads the expected ids and rules from the compare branch database', () => {
    initRepo([
      ['a', ['no-console']],
      ['b', ['no-debugger']],
    ]);

    const info = runGetCompareInfo({
      compareBranch: 'main',
      databaseFile: DB_FILE,
    });

    expect(info.compareBranchName).toBe('main');
    expect(info.compareDatabase.getIds()).toEqual(
      new Map([
        ['a', ['no-console']],
        ['b', ['no-debugger']],
      ])
    );
  });

  it('returns an empty database when the compare branch database has no ids', () => {
    initRepo([]);

    const info = runGetCompareInfo({
      compareBranch: 'main',
      databaseFile: DB_FILE,
    });

    expect(info.compareDatabase.getIds()).toEqual(new Map());
  });
});
