import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRAGMA } from '../../util/constants.js';
import { validate } from '../../validate/validate.js';
import { makeId } from '../helpers/ids.js';

const INTEGRATION_DIR = import.meta.dirname;
// The real fixture sources carry legacy comments for CONSOLE_ID / DEBUGGER_ID.
const FIXTURE_SRC = join(INTEGRATION_DIR, 'fixtures', 'project', 'src');
const DATABASES_DIR = join(INTEGRATION_DIR, 'fixtures', 'databases');

// Ids baked into the static fixtures (fixtures/project/src/*.ts and
// fixtures/databases/*.json). Static files can't reference ID_LENGTH, so these
// literals must be kept in sync with those fixtures by hand.
const CONSOLE_ID = 'c0nsole00000';
const DEBUGGER_ID = 'debugger0000';
const UNUSED_ID = 'unused000000';

// validate always compares the working database against the compare branch via
// `git show main:<config/db>`, so every case runs against a throwaway git repo in
// a temp dir: it commits a baseline on `main`, then validates on `feature`.
// Committing a `main` baseline that matches the working state keeps
// compareWithBranch silent, leaving whatever the test targets as the only error;
// the compare-drift case is the one exception and diverges from main on purpose.
// The pid keeps parallel vitest workers from colliding on the same temp dir.
const REPO_DIR = join(
  tmpdir(),
  `lint-legacies-validate-${process.pid.toString()}`
);
// git show interpolates these paths directly so they must be repo-relative, and
// validate runs with the repo as cwd so it resolves them the same way.
const CONFIG_REL = 'legacy-lint.config.jsonc';
const DATA_REL = 'legacy-lint.data.json';
const WORKING_DATA = join(REPO_DIR, DATA_REL);

type DatabaseContents = [string, string[]][];

function makeConfig(nonDisableableRules: string[] = []) {
  return {
    ignoreWarnings: false,
    pragma: DEFAULT_PRAGMA,
    databaseFile: DATA_REL,
    nonDisableableRules,
    compareBranch: 'main',
    linterType: 'eslint',
  };
}

function git(args: string[]) {
  execFileSync('git', args, { cwd: REPO_DIR, stdio: 'pipe' });
}

// Build a git repo whose `main` commit holds the given config, database, and
// source tree, then switch to `feature` (the branch validate runs against).
// `seed` writes the source files into the repo before the baseline commit.
function initRepo({
  db,
  config = makeConfig(),
  seed,
}: {
  db: DatabaseContents;
  config?: ReturnType<typeof makeConfig>;
  seed: () => void;
}) {
  rmSync(REPO_DIR, { recursive: true, force: true });
  mkdirSync(REPO_DIR, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(REPO_DIR, CONFIG_REL), JSON.stringify(config));
  writeFileSync(WORKING_DATA, JSON.stringify(db));
  seed();
  git(['add', '-A']);
  git(['commit', '-m', 'baseline']);
  git(['checkout', '-b', 'feature']);
}

// Copy the checked-in fixture sources (real legacy comments for CONSOLE_ID /
// DEBUGGER_ID) into the repo's src dir.
function seedFixtureSources() {
  cpSync(FIXTURE_SRC, join(REPO_DIR, 'src'), { recursive: true });
}

// Write a single throwaway source file at src/<name> in the repo.
function seedSource(name: string, lines: string[]) {
  const srcDir = join(REPO_DIR, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, name), lines.join('\n'));
}

function loadDbFixture(scenario: string): DatabaseContents {
  return JSON.parse(
    readFileSync(join(DATABASES_DIR, scenario), 'utf-8')
  ) as DatabaseContents;
}

// The data file is an array of [id, rules] tuples.
function readData(): DatabaseContents {
  return JSON.parse(readFileSync(WORKING_DATA, 'utf-8')) as DatabaseContents;
}

// validate resolves the repo-relative config against cwd, so run it with the repo
// as cwd. Restore in finally so a throw doesn't strand the suite.
function runValidate(update = false) {
  const originalCwd = process.cwd();
  process.chdir(REPO_DIR);
  try {
    validate({ config: CONFIG_REL, verbose: false, update });
  } finally {
    process.chdir(originalCwd);
  }
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
}

describe('validate (integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(REPO_DIR, { recursive: true, force: true });
  });

  it('exits with an error when the data file does not exist', () => {
    initRepo({ db: loadDbFixture('all-used.json'), seed: seedFixtureSources });
    // readDatabase runs before the compare step, so deleting the working data
    // file trips the missing-file guard first.
    rmSync(WORKING_DATA, { force: true });
    const exitSpy = mockExit();
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    expect(() => {
      runValidate();
    }).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('does not exist')
    );
  });

  it('passes cleanly when every database id is found in code', () => {
    initRepo({ db: loadDbFixture('all-used.json'), seed: seedFixtureSources });
    expect(() => {
      runValidate();
    }).not.toThrow();
    // The database is left untouched on a clean run.
    expect(readData()).toEqual([
      [CONSOLE_ID, ['no-console']],
      [DEBUGGER_ID, ['no-debugger']],
    ]);
  });

  describe('when a legacied error was fixed (an unused id remains)', () => {
    it('rewrites the database with only the used ids when --update is set', () => {
      initRepo({
        db: loadDbFixture('has-unused.json'),
        seed: seedFixtureSources,
      });
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      runValidate(true);
      // UNUSED_ID is dropped; the surviving ids keep their recorded rules.
      expect(readData()).toEqual([
        [CONSOLE_ID, ['no-console']],
        [DEBUGGER_ID, ['no-debugger']],
      ]);
    });

    it('exits with an error and leaves the database untouched without --update', () => {
      initRepo({
        db: loadDbFixture('has-unused.json'),
        seed: seedFixtureSources,
      });
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runValidate();
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalled();
      expect(readData()).toEqual([
        [CONSOLE_ID, ['no-console']],
        [DEBUGGER_ID, ['no-debugger']],
        [UNUSED_ID, ['no-console']],
      ]);
    });
  });

  it('exits with an error when code references an unregistered id', () => {
    initRepo({
      db: loadDbFixture('unregistered.json'),
      seed: seedFixtureSources,
    });
    const exitSpy = mockExit();
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    expect(() => {
      runValidate();
    }).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    // DEBUGGER_ID is not registered in the database, so its comment is reported.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unregistered legacy error.')
    );
  });

  // A malformed legacy comment takes a different validate branch than an
  // unregistered id: parseDisableComment records the error before validateIds
  // ever runs. This drives that path end-to-end through validate().
  describe('with a malformed legacy comment', () => {
    it('exits 1 and reports the malformed comment with its file and line', () => {
      initRepo({
        db: [],
        // A 7-char id; the parser requires exactly ID_LENGTH, so this is malformed.
        seed: () => {
          seedSource('bad.ts', [
            'export function logSomething(): void {',
            `  // eslint-disable-next-line no-console -- ${DEFAULT_PRAGMA} (no-console) tooshrt`,
            "  console.log('x');",
            '}',
            '',
          ]);
        },
      });

      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runValidate();
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      // Errors are grouped under a per-file header (relative to the config's
      // rootDir), then listed indented and prefixed with the offending line
      // number. The comment sits on the second line, displayed 1-indexed as
      // `2:`.
      expect(errorSpy).toHaveBeenCalledWith(`${join('src', 'bad.ts')}:`);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('2: Malformed legacy comment:')
      );
    });
  });

  // A plain (non-legacy) disable comment takes the else branch of validate's
  // comment-collection loop: it is gathered into nonLegacyComments and only
  // reported when it disables a non-disableable rule.
  describe('with a non-legacy disable comment', () => {
    function setup(nonDisableableRules: string[]) {
      initRepo({
        db: [],
        config: makeConfig(nonDisableableRules),
        // A regular disable comment with no legacy pragma.
        seed: () => {
          seedSource('plain.ts', [
            'export function logSomething(): void {',
            '  // eslint-disable-next-line no-console',
            "  console.log('x');",
            '}',
            '',
          ]);
        },
      });
    }

    it('passes cleanly when the disabled rule is not non-disableable', () => {
      setup([]);
      expect(() => {
        runValidate();
      }).not.toThrow();
    });

    it('exits 1 and reports the rule when it is non-disableable', () => {
      setup(['no-console']);
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runValidate();
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rule "no-console" cannot be disabled.')
      );
    });
  });

  // A blanket disable (no rule list) is caught in parseComments, before any id
  // validation runs: it is rejected outright whenever any rule is
  // non-disableable, since it would silently turn those rules off.
  describe('with a disable-all comment', () => {
    function setup(nonDisableableRules: string[]) {
      initRepo({
        db: [],
        config: makeConfig(nonDisableableRules),
        // A blanket disable with no rule list.
        seed: () => {
          seedSource('blanket.ts', [
            '/* eslint-disable */',
            'export function logSomething(): void {',
            "  console.log('x');",
            '}',
            '',
          ]);
        },
      });
    }

    it('passes cleanly when no rules are non-disableable', () => {
      setup([]);
      expect(() => {
        runValidate();
      }).not.toThrow();
    });

    it('exits 1 and reports the disable-all when a rule is non-disableable', () => {
      setup(['no-console']);
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runValidate();
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Disabling all rules is not allowed')
      );
    });
  });

  // A file that fails to parse must fail validation outright: otherwise a user
  // could hide a disable of a non-disableable rule inside a file oxc can't even
  // read. getFileComments records the parser error and validate exits before any
  // id checks run.
  describe('with a syntax error', () => {
    it('exits 1 and reports the parse error', () => {
      initRepo({
        db: [],
        // The bad `;` (no initializer expression) sits on the second line, so oxc
        // cannot parse it and reports the error against that line.
        seed: () => {
          seedSource('broken.ts', ['export const x = 1;', 'const y = ;', '']);
        },
      });

      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runValidate();
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      // The error is grouped under the file header (relative to rootDir) and
      // listed with its line displayed 1-indexed as `2:`, proving the parser
      // offset was resolved to a location rather than falling back to the
      // "Global" bucket.
      expect(errorSpy).toHaveBeenCalledWith(`${join('src', 'broken.ts')}:`);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('2: Errors parsing file:')
      );
    });
  });

  // validate always compares the current database against the compare branch, so
  // a database that has drifted from main -- here a legacy id absent from main --
  // must be rejected. The baseline is committed on main, then feature diverges by
  // registering the new id (plus a matching source comment so it is found in code,
  // leaving the compare check as the only error).
  describe('compare drift', () => {
    it('exits 1 and reports a new legacy id that is absent from the compare branch', () => {
      initRepo({
        db: [],
        seed: () => {
          seedSource('uses.ts', ['export const noop = true;', '']);
        },
      });
      const newId = makeId('newid');
      writeFileSync(WORKING_DATA, JSON.stringify([[newId, ['no-console']]]));
      seedSource('uses.ts', [
        'export function logSomething(): void {',
        `  // eslint-disable-next-line no-console -- ${DEFAULT_PRAGMA} (no-console) ${newId}`,
        "  console.log('x');",
        '}',
        '',
      ]);

      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runValidate();
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('does not exist in the database on main')
      );
    });
  });
});
