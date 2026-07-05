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
// git show interpolates these paths directly, so they must be repo-relative.
const CONFIG_FILE = 'legacy-lint.config.jsonc';
const DB_FILE = 'legacy-lint.data.json';

const BASE_CONFIG: Config = {
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

// compareWithBranch runs git in process.cwd() and resolves the config/database
// paths relative to it, so the call must happen with the temp repo as cwd.
// Restore in finally so a throw doesn't leave the suite pointed at the temp dir.
function runCompare({
  currentConfig,
  currentDatabase,
}: {
  currentConfig: Config;
  currentDatabase: Database;
}): ValidationError[] {
  const validationErrors: ValidationError[] = [];
  const originalCwd = process.cwd();
  process.chdir(REPO_DIR);
  try {
    compareWithBranch({
      currentDatabase,
      currentConfig,
      configFilePath: CONFIG_FILE,
      validationErrors,
    });
  } finally {
    process.chdir(originalCwd);
  }
  return validationErrors;
}

// Build the in-memory "current" database the same way the real code does.
function makeDatabase(contents: [string, string[]][]): Database {
  return createDatabase({ filePath: undefined, databaseContents: contents });
}

describe('compareWithBranch (integration)', () => {
  afterEach(() => {
    rmSync(REPO_DIR, { recursive: true, force: true });
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
