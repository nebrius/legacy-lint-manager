import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { compareDatabases } from '../../validate/compareDatabases.js';

// compareDatabases shells out to git, so each test builds a throwaway repo in a
// temp dir, commits a baseline database on `main`, runs the compare against it,
// and removes the dir afterwards. This exercises the real `git show` /
// `git symbolic-ref` plumbing without touching the developer's repo or relying
// on a committed long-lived test branch. The pid keeps parallel vitest workers
// from colliding on the same temp dir.
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
// then move to a `feature` branch (the working branch whose usedIds we pass in).
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

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
}

// compareDatabases runs git in process.cwd() and resolves databaseFile relative
// to it, so the call must happen with the temp repo as cwd. Restore in finally
// so a thrown process.exit doesn't leave the suite pointed at the temp dir.
function runCompare(args: Parameters<typeof compareDatabases>[0]) {
  const originalCwd = process.cwd();
  process.chdir(REPO_DIR);
  try {
    compareDatabases(args);
  } finally {
    process.chdir(originalCwd);
  }
}

describe('compareDatabases (integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(REPO_DIR, { recursive: true, force: true });
  });

  describe('with an explicit compare branch', () => {
    it('passes when no new ids were introduced', () => {
      initRepo(['a', 'b']);
      const exitSpy = mockExit();

      expect(() => {
        runCompare({
          compareBranch: 'main',
          usedIds: ['a', 'b'],
          databaseFile: DB_FILE,
        });
      }).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 1 and names the offending id when a new id appears', () => {
      initRepo(['a', 'b']);
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runCompare({
          compareBranch: 'main',
          usedIds: ['a', 'b', 'c'],
          databaseFile: DB_FILE,
        });
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('c'));
    });

    it('passes when ids were only removed', () => {
      initRepo(['a', 'b', 'c']);
      const exitSpy = mockExit();

      expect(() => {
        runCompare({
          compareBranch: 'main',
          usedIds: ['a'],
          databaseFile: DB_FILE,
        });
      }).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('with no compare branch (resolves origin/HEAD)', () => {
    // The undefined-branch path runs `git symbolic-ref refs/remotes/origin/HEAD`,
    // which only resolves when the repo has an origin remote with a known HEAD.
    // We give it one by cloning the working repo into a bare repo that acts as
    // origin, wiring it back as the remote, and setting origin/HEAD to main.
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
      git(['remote', 'set-head', 'origin', '-a']);
    }

    it('resolves the default branch and exits 1 on a new id', () => {
      initRepo(['a', 'b']);
      addOrigin();
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runCompare({
          compareBranch: undefined,
          usedIds: ['a', 'b', 'c'],
          databaseFile: DB_FILE,
        });
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('c'));
    });
  });
});
