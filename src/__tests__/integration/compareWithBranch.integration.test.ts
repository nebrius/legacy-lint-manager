import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Config } from '../../util/config.js';
import type { Database } from '../../util/db.js';
import { createDatabase } from '../../util/db.js';
import type { ValidationError } from '../../util/types.js';
import { compareWithBranch } from '../../validate/compareWithBranch.js';

// compareWithBranch shells out to git (`git show <branch>:<path>`) to read the
// compare branch's config and database, so each test builds a throwaway repo in
// a temp dir: it commits a baseline config + database on `main`, moves to a
// `feature` branch, then runs compareWithBranch against in-memory "current"
// state. This exercises the real git plumbing (including the private
// getCompareInfo) without touching the developer's repo. The pid keeps parallel
// vitest workers from colliding on the same temp dir.
const REPO_DIR = join(
  tmpdir(),
  `lint-legacies-compare-with-branch-${process.pid.toString()}`
);
// A bare "origin" used by the single-branch-checkout test to give REPO_DIR a
// remote-tracking `main` ref without a local `main` branch.
const ORIGIN_DIR = join(
  tmpdir(),
  `lint-legacies-compare-with-branch-origin-${process.pid.toString()}`
);
// git show interpolates these paths directly, so they must be repo-relative.
const CONFIG_FILE = 'legacy-lint.config.jsonc';
const DB_FILE = 'legacy-lint.data.json';

const BASE_CONFIG: Config = {
  lintCommand: { command: 'npx', args: ['eslint', '--format=json'] },
  ignoreWarnings: false,
  pragma: 'This lint error is legacied. DO NOT COPY',
  databaseFile: DB_FILE,
  nonDisableableRules: [],
  compareBranch: 'main',
  linterType: 'eslint',
};

function git(args: string[]) {
  execFileSync('git', args, { cwd: REPO_DIR, stdio: 'pipe' });
}

// Build a repo on `main` whose committed config + database hold the given
// baseline, then move to a `feature` branch (the working branch compareWithBranch
// reads from). The config's databaseFile controls where the database is written,
// so a rename can be exercised by committing a config that points at a different
// databaseFile than the current config uses.
function initRepo({
  config,
  db,
}: {
  config: Config;
  db: [string, string[]][];
}) {
  mkdirSync(REPO_DIR, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(REPO_DIR, CONFIG_FILE), JSON.stringify(config));
  writeFileSync(join(REPO_DIR, config.databaseFile), JSON.stringify(db));
  git(['add', '-A']);
  git(['commit', '-m', 'baseline']);
  git(['checkout', '-b', 'feature']);
}

// Simulate a CI single-branch checkout: push `main` to a bare "origin", then
// drop the local `main` branch so only `refs/remotes/origin/main` remains. After
// this, `git rev-parse --verify main` fails, so getCompareInfo must fall back to
// reading the compare config and database from `origin/main`.
function detachMainToOrigin() {
  git(['init', '--bare', ORIGIN_DIR]);
  git(['remote', 'add', 'origin', ORIGIN_DIR]);
  git(['push', 'origin', 'main']);
  git(['fetch', 'origin']);
  git(['branch', '-D', 'main']);
}

// compareWithBranch takes an absolute configFilePath plus the repoRootDir, and
// shells out to git with repoRootDir as the cwd, so it does not depend on
// process.cwd(). The relative CONFIG_FILE/DB_FILE constants describe the on-disk
// repo layout; only the value handed to compareWithBranch is made absolute,
// mirroring how validate.ts resolves and passes them in production.
function runCompare({
  currentConfig,
  currentDatabase,
}: {
  currentConfig: Config;
  currentDatabase: Database;
}): ValidationError[] {
  const validationErrors: ValidationError[] = [];
  compareWithBranch({
    currentDatabase,
    currentConfig,
    configFilePath: join(REPO_DIR, CONFIG_FILE),
    validationErrors,
    repoRootDir: REPO_DIR,
  });
  return validationErrors;
}

// Build the in-memory "current" database the same way the real code does.
function makeDatabase(contents: [string, string[]][]): Database {
  return createDatabase({ filePath: undefined, databaseContents: contents });
}

// A monorepo variant of a config. Ignore paths are absolute (as they are once a
// real config is parsed) and under REPO_DIR so the drift message can render them
// relative to the repo root.
function withMonorepo(config: Config, ignorePackagePaths: string[]): Config {
  return { ...config, monorepoConfig: { ignorePackagePaths } };
}

describe('compareWithBranch (integration)', () => {
  afterEach(() => {
    rmSync(REPO_DIR, { recursive: true, force: true });
    rmSync(ORIGIN_DIR, { recursive: true, force: true });
  });

  it('records no errors when the current config and database match the compare branch', () => {
    initRepo({
      config: BASE_CONFIG,
      db: [
        ['a', ['no-console']],
        ['b', ['no-debugger']],
      ],
    });

    const errors = runCompare({
      currentConfig: BASE_CONFIG,
      currentDatabase: makeDatabase([
        ['a', ['no-console']],
        ['b', ['no-debugger']],
      ]),
    });

    expect(errors).toEqual([]);
  });

  it('reads the compare config and database from origin when the branch is not a local ref', () => {
    // With only a remote-tracking `origin/main` (no local `main`),
    // getCompareInfo must fall back to reading everything from origin/main.
    initRepo({ config: BASE_CONFIG, db: [['a', ['no-console']]] });
    detachMainToOrigin();

    const errors = runCompare({
      currentConfig: BASE_CONFIG,
      currentDatabase: makeDatabase([['a', ['no-console']]]),
    });

    // A clean, no-drift read proves both the config and the database were
    // resolved and read from origin/main.
    expect(errors).toEqual([]);
  });

  describe('database id and rule checks', () => {
    it('records a global error when a database id is absent from the compare branch', () => {
      initRepo({ config: BASE_CONFIG, db: [] });

      const errors = runCompare({
        currentConfig: BASE_CONFIG,
        currentDatabase: makeDatabase([['new', ['no-console']]]),
      });

      expect(errors).toEqual([
        {
          message:
            'Legacy ID "new" does not exist in the database on main. New legacy entries cannot be added.',
        },
      ]);
    });

    it('flags only the ids missing from the compare branch', () => {
      initRepo({ config: BASE_CONFIG, db: [['old', ['no-console']]] });

      const errors = runCompare({
        currentConfig: BASE_CONFIG,
        currentDatabase: makeDatabase([
          ['old', ['no-console']],
          ['new', ['no-console']],
        ]),
      });

      expect(errors).toEqual([
        {
          message:
            'Legacy ID "new" does not exist in the database on main. New legacy entries cannot be added.',
        },
      ]);
    });

    it('allows removing a rule from an existing id (current rules are a subset)', () => {
      initRepo({
        config: BASE_CONFIG,
        db: [['id1', ['no-console', 'no-debugger']]],
      });

      const errors = runCompare({
        currentConfig: BASE_CONFIG,
        currentDatabase: makeDatabase([['id1', ['no-console']]]),
      });

      expect(errors).toEqual([]);
    });

    it('records one global error per rule that is new relative to the compare branch', () => {
      initRepo({ config: BASE_CONFIG, db: [['id1', ['no-console']]] });

      const errors = runCompare({
        currentConfig: BASE_CONFIG,
        currentDatabase: makeDatabase([
          ['id1', ['no-console', 'no-debugger', 'no-var']],
        ]),
      });

      expect(errors).toEqual([
        {
          message:
            'Rule "no-debugger" for legacy ID "id1" is not defined in the database on main. New rules cannot be added to existing legacy entries.',
        },
        {
          message:
            'Rule "no-var" for legacy ID "id1" is not defined in the database on main. New rules cannot be added to existing legacy entries.',
        },
      ]);
    });
  });

  describe('load-bearing config drift', () => {
    it('records an error when the compare branch is different', () => {
      // The compare branch's own config claims a different compareBranch than
      // the current config, which would let the two branches drift apart.
      initRepo({
        config: { ...BASE_CONFIG, compareBranch: 'develop' },
        db: [],
      });

      const errors = runCompare({
        currentConfig: BASE_CONFIG,
        currentDatabase: makeDatabase([]),
      });

      expect(errors).toEqual([
        {
          message:
            'The compare branch in the current config (main) does not match the compare branch in the compare config (develop).',
        },
      ]);
    });

    it('records an error when ignoreWarnings differs', () => {
      initRepo({ config: { ...BASE_CONFIG, ignoreWarnings: true }, db: [] });

      const errors = runCompare({
        currentConfig: BASE_CONFIG,
        currentDatabase: makeDatabase([]),
      });

      expect(errors).toEqual([
        {
          message:
            'The ignore warnings in the current config do not match the ignore warnings in the compare config.',
        },
      ]);
    });

    it('records an error when the pragma differs', () => {
      initRepo({
        config: { ...BASE_CONFIG, pragma: 'A different pragma' },
        db: [],
      });

      const errors = runCompare({
        currentConfig: BASE_CONFIG,
        currentDatabase: makeDatabase([]),
      });

      expect(errors).toEqual([
        {
          message:
            'The pragma in the current config does not match the pragma in the compare config.',
        },
      ]);
    });

    it('flags only the non-disableable rules that were removed relative to the compare branch', () => {
      // no-eval was dropped from the current config (flagged); no-alert is still
      // present (allowed), so only no-eval is reported.
      initRepo({
        config: {
          ...BASE_CONFIG,
          nonDisableableRules: ['no-eval', 'no-alert'],
        },
        db: [],
      });

      const errors = runCompare({
        currentConfig: { ...BASE_CONFIG, nonDisableableRules: ['no-alert'] },
        currentDatabase: makeDatabase([]),
      });

      expect(errors).toEqual([
        {
          message:
            'The non-disableable rule "no-eval" is not defined in the current config. Non-disableable rules cannot be removed from the compare branch.',
        },
      ]);
    });
  });

  // The monorepo shape of the config is itself load-bearing: it cannot silently
  // appear/disappear between branches, and its ignore list can only shrink — a
  // new ignored package would hide errors that the compare branch still enforces.
  describe('monorepo config drift', () => {
    it('records an error when the current config is a monorepo but the compare branch is not', () => {
      initRepo({ config: BASE_CONFIG, db: [] });

      const errors = runCompare({
        currentConfig: withMonorepo(BASE_CONFIG, []),
        currentDatabase: makeDatabase([]),
      });

      expect(errors).toEqual([
        { message: 'The config has been converted to a monorepo config.' },
      ]);
    });

    it('records an error when the compare branch is a monorepo but the current config is not', () => {
      initRepo({ config: withMonorepo(BASE_CONFIG, []), db: [] });

      const errors = runCompare({
        currentConfig: BASE_CONFIG,
        currentDatabase: makeDatabase([]),
      });

      expect(errors).toEqual([
        { message: 'The config has been converted from a monorepo config.' },
      ]);
    });

    it('records an error when a new ignored package is added relative to the compare branch', () => {
      const existing = join(REPO_DIR, 'packages', 'existing');
      const added = join(REPO_DIR, 'packages', 'added');
      initRepo({ config: withMonorepo(BASE_CONFIG, [existing]), db: [] });

      const errors = runCompare({
        currentConfig: withMonorepo(BASE_CONFIG, [existing, added]),
        currentDatabase: makeDatabase([]),
      });

      // Only the newly-ignored package is reported, rendered relative to the repo.
      expect(errors).toEqual([
        {
          message: `New ignored packages cannot be added to the config. New packages found: ${join('packages', 'added')}`,
        },
      ]);
    });

    it('records no error when the monorepo ignore lists match', () => {
      const ignored = join(REPO_DIR, 'packages', 'ignored');
      initRepo({ config: withMonorepo(BASE_CONFIG, [ignored]), db: [] });

      const errors = runCompare({
        currentConfig: withMonorepo(BASE_CONFIG, [ignored]),
        currentDatabase: makeDatabase([]),
      });

      // Removing an ignored package is allowed (it only re-enables enforcement),
      // so an identical list — and a shorter one — must not be flagged.
      expect(errors).toEqual([]);
    });
  });

  it('reads the compare database from the compare config’s databaseFile, tracking renames', () => {
    // The compare branch keeps its database at old-db.json; the current config
    // has since renamed it to new-db.json. compareWithBranch must resolve the
    // compare database via the compare branch's own config, so reading it from
    // old-db.json succeeds (reading new-db.json from main would throw).
    initRepo({
      config: { ...BASE_CONFIG, databaseFile: 'old-db.json' },
      db: [['keep', ['no-console']]],
    });

    const errors = runCompare({
      currentConfig: { ...BASE_CONFIG, databaseFile: 'new-db.json' },
      currentDatabase: makeDatabase([
        ['keep', ['no-console']],
        ['added', ['no-console']],
      ]),
    });

    // "keep" matched the compare database read from old-db.json; only "added" is
    // flagged as new.
    expect(errors).toEqual([
      {
        message:
          'Legacy ID "added" does not exist in the database on main. New legacy entries cannot be added.',
      },
    ]);
  });
});
