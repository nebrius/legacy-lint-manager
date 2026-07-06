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

const INTEGRATION_DIR = import.meta.dirname;
const PROJECT_DIR = join(INTEGRATION_DIR, 'fixtures', 'project');
const DATABASES_DIR = join(INTEGRATION_DIR, 'fixtures', 'databases');

// The config and data files live at the root of the sample project (mirroring
// how they sit relative to the code in real usage) and are gitignored, so
// mutating them during the --update test never dirties the repo.
const CONFIG_FILE = join(PROJECT_DIR, 'legacy-lint.config.jsonc');
const WORKING_DATA = join(PROJECT_DIR, 'legacy-lint.data.json');

// Write a config file in the project dir. validate derives rootDir from
// dirname(config), so the config must sit alongside the source it validates.
// databaseFile is absolute so readDatabase resolves it regardless of cwd.
function writeConfig(databaseFile = WORKING_DATA) {
  writeFileSync(
    CONFIG_FILE,
    JSON.stringify({
      ignoreWarnings: false,
      pragma: DEFAULT_PRAGMA,
      databaseFile,
      nonDisableableRules: [],
      compareBranch: 'main',
      linterType: 'eslint',
    })
  );
}

function useDatabase(scenario: string) {
  cpSync(join(DATABASES_DIR, scenario), WORKING_DATA);
}

// The data file is now an array of [id, rules] tuples.
function readData(): [string, string[]][] {
  return JSON.parse(readFileSync(WORKING_DATA, 'utf-8')) as [
    string,
    string[],
  ][];
}

function runValidate(update: boolean) {
  validate({
    config: CONFIG_FILE,
    verbose: false,
    update,
    compare: false,
  });
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
}

describe('validate (integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(WORKING_DATA, { force: true });
    rmSync(CONFIG_FILE, { force: true });
  });

  it('exits with an error when the data file does not exist', () => {
    writeConfig();
    rmSync(WORKING_DATA, { force: true });
    const exitSpy = mockExit();
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    expect(() => {
      runValidate(false);
    }).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('does not exist')
    );
  });

  it('passes cleanly when every database id is found in code', () => {
    writeConfig();
    useDatabase('all-used.json');
    expect(() => {
      runValidate(false);
    }).not.toThrow();
    // The database is left untouched on a clean run.
    expect(readData()).toEqual([
      ['c0nsole1', ['no-console']],
      ['debugg02', ['no-debugger']],
    ]);
  });

  describe('when a legacied error was fixed (an unused id remains)', () => {
    it('rewrites the database with only the used ids when --update is set', () => {
      writeConfig();
      useDatabase('has-unused.json');
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      runValidate(true);
      // unused01 is dropped; the surviving ids keep their recorded rules.
      expect(readData()).toEqual([
        ['c0nsole1', ['no-console']],
        ['debugg02', ['no-debugger']],
      ]);
    });

    it('exits with an error and leaves the database untouched without --update', () => {
      writeConfig();
      useDatabase('has-unused.json');
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runValidate(false);
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalled();
      expect(readData()).toEqual([
        ['c0nsole1', ['no-console']],
        ['debugg02', ['no-debugger']],
        ['unused01', ['no-console']],
      ]);
    });
  });

  it('exits with an error when code references an unregistered id', () => {
    writeConfig();
    useDatabase('unregistered.json');
    const exitSpy = mockExit();
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    expect(() => {
      runValidate(false);
    }).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    // debugg02 is not registered in the database, so its comment is reported.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unregistered legacy error.')
    );
  });

  // A malformed legacy comment takes a different validate branch than an
  // unregistered id: parseDisableComment records the error before validateIds
  // ever runs. This drives that path end-to-end through validate(). The project
  // is built in a temp dir so the malformed source never lives in the shared
  // fixture (which other tests and the smoke test expect to stay clean).
  describe('with a malformed legacy comment', () => {
    const MALFORMED_PROJECT = join(tmpdir(), 'lint-legacies-malformed-project');
    const MALFORMED_SRC = join(MALFORMED_PROJECT, 'src');
    const MALFORMED_FILE = join(MALFORMED_SRC, 'bad.ts');
    const MALFORMED_CONFIG = join(
      MALFORMED_PROJECT,
      'legacy-lint.config.jsonc'
    );
    const MALFORMED_DATA = join(MALFORMED_PROJECT, 'legacy-lint.data.json');

    afterEach(() => {
      rmSync(MALFORMED_PROJECT, { recursive: true, force: true });
    });

    it('exits 1 and reports the malformed comment with its file and line', () => {
      mkdirSync(MALFORMED_SRC, { recursive: true });
      writeFileSync(MALFORMED_DATA, JSON.stringify([]));
      writeFileSync(
        MALFORMED_CONFIG,
        JSON.stringify({
          ignoreWarnings: false,
          pragma: DEFAULT_PRAGMA,
          databaseFile: MALFORMED_DATA,
          nonDisableableRules: [],
          compareBranch: 'main',
          linterType: 'eslint',
        })
      );
      // A 7-char id; the parser requires exactly 8, so this is malformed.
      writeFileSync(
        MALFORMED_FILE,
        [
          'export function logSomething(): void {',
          `  // eslint-disable-next-line no-console -- ${DEFAULT_PRAGMA} (no-console) tooshrt`,
          "  console.log('x');",
          '}',
          '',
        ].join('\n')
      );

      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        validate({
          config: MALFORMED_CONFIG,
          verbose: false,
          update: false,
          compare: false,
        });
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      // Errors are grouped under a per-file header (relative to the config's
      // rootDir), then listed indented and prefixed with the offending line
      // number. The comment sits on the visually-2nd line, but validate prints
      // the 0-indexed startLine verbatim, so the line reads `1:` (an off-by-one
      // in the user-facing output).
      expect(errorSpy).toHaveBeenCalledWith(`${join('src', 'bad.ts')}:`);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('1: Malformed legacy comment:')
      );
    });
  });

  // A plain (non-legacy) disable comment takes the else branch of validate's
  // comment-collection loop: it is gathered into nonLegacyComments and only
  // reported when it disables a non-disableable rule. The project is built in a
  // temp dir so these throwaway sources never touch the shared fixture.
  describe('with a non-legacy disable comment', () => {
    const NONLEGACY_PROJECT = join(tmpdir(), 'lint-legacies-nonlegacy-project');
    const NONLEGACY_SRC = join(NONLEGACY_PROJECT, 'src');
    const NONLEGACY_FILE = join(NONLEGACY_SRC, 'plain.ts');
    const NONLEGACY_CONFIG = join(
      NONLEGACY_PROJECT,
      'legacy-lint.config.jsonc'
    );
    const NONLEGACY_DATA = join(NONLEGACY_PROJECT, 'legacy-lint.data.json');

    function setup(nonDisableableRules: string[]) {
      mkdirSync(NONLEGACY_SRC, { recursive: true });
      writeFileSync(NONLEGACY_DATA, JSON.stringify([]));
      writeFileSync(
        NONLEGACY_CONFIG,
        JSON.stringify({
          ignoreWarnings: false,
          pragma: DEFAULT_PRAGMA,
          databaseFile: NONLEGACY_DATA,
          nonDisableableRules,
          compareBranch: 'main',
          linterType: 'eslint',
        })
      );
      // A regular disable comment with no legacy pragma.
      writeFileSync(
        NONLEGACY_FILE,
        [
          'export function logSomething(): void {',
          '  // eslint-disable-next-line no-console',
          "  console.log('x');",
          '}',
          '',
        ].join('\n')
      );
    }

    function runNonLegacyValidate() {
      validate({
        config: NONLEGACY_CONFIG,
        verbose: false,
        update: false,
        compare: false,
      });
    }

    afterEach(() => {
      rmSync(NONLEGACY_PROJECT, { recursive: true, force: true });
    });

    it('passes cleanly when the disabled rule is not non-disableable', () => {
      setup([]);
      expect(() => {
        runNonLegacyValidate();
      }).not.toThrow();
    });

    it('exits 1 and reports the rule when it is non-disableable', () => {
      setup(['no-console']);
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runNonLegacyValidate();
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rule "no-console" cannot be disabled.')
      );
    });
  });

  // A blanket disable (no rule list) is caught in parseComments, before any id
  // validation runs: it is rejected outright whenever any rule is
  // non-disableable, since it would silently turn those rules off. The project
  // is built in a temp dir so these throwaway sources never touch the shared
  // fixture.
  describe('with a disable-all comment', () => {
    const DISABLE_ALL_PROJECT = join(
      tmpdir(),
      'lint-legacies-disable-all-project'
    );
    const DISABLE_ALL_SRC = join(DISABLE_ALL_PROJECT, 'src');
    const DISABLE_ALL_FILE = join(DISABLE_ALL_SRC, 'blanket.ts');
    const DISABLE_ALL_CONFIG = join(
      DISABLE_ALL_PROJECT,
      'legacy-lint.config.jsonc'
    );
    const DISABLE_ALL_DATA = join(DISABLE_ALL_PROJECT, 'legacy-lint.data.json');

    function setup(nonDisableableRules: string[]) {
      mkdirSync(DISABLE_ALL_SRC, { recursive: true });
      writeFileSync(DISABLE_ALL_DATA, JSON.stringify([]));
      writeFileSync(
        DISABLE_ALL_CONFIG,
        JSON.stringify({
          ignoreWarnings: false,
          pragma: DEFAULT_PRAGMA,
          databaseFile: DISABLE_ALL_DATA,
          nonDisableableRules,
          compareBranch: 'main',
          linterType: 'eslint',
        })
      );
      // A blanket disable with no rule list.
      writeFileSync(
        DISABLE_ALL_FILE,
        [
          '/* eslint-disable */',
          'export function logSomething(): void {',
          "  console.log('x');",
          '}',
          '',
        ].join('\n')
      );
    }

    function runDisableAllValidate() {
      validate({
        config: DISABLE_ALL_CONFIG,
        verbose: false,
        update: false,
        compare: false,
      });
    }

    afterEach(() => {
      rmSync(DISABLE_ALL_PROJECT, { recursive: true, force: true });
    });

    it('passes cleanly when no rules are non-disableable', () => {
      setup([]);
      expect(() => {
        runDisableAllValidate();
      }).not.toThrow();
    });

    it('exits 1 and reports the disable-all when a rule is non-disableable', () => {
      setup(['no-console']);
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runDisableAllValidate();
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
  // id checks run. The project is built in a temp dir so the broken source never
  // touches the shared fixture.
  describe('with a syntax error', () => {
    const SYNTAX_PROJECT = join(tmpdir(), 'lint-legacies-syntax-project');
    const SYNTAX_SRC = join(SYNTAX_PROJECT, 'src');
    const SYNTAX_FILE = join(SYNTAX_SRC, 'broken.ts');
    const SYNTAX_CONFIG = join(SYNTAX_PROJECT, 'legacy-lint.config.jsonc');
    const SYNTAX_DATA = join(SYNTAX_PROJECT, 'legacy-lint.data.json');

    afterEach(() => {
      rmSync(SYNTAX_PROJECT, { recursive: true, force: true });
    });

    it('exits 1 and reports the parse error', () => {
      mkdirSync(SYNTAX_SRC, { recursive: true });
      writeFileSync(SYNTAX_DATA, JSON.stringify([]));
      writeFileSync(
        SYNTAX_CONFIG,
        JSON.stringify({
          ignoreWarnings: false,
          pragma: DEFAULT_PRAGMA,
          databaseFile: SYNTAX_DATA,
          nonDisableableRules: [],
          compareBranch: 'main',
          linterType: 'eslint',
        })
      );
      // The bad `;` (no initializer expression) sits on the second line, so oxc
      // cannot parse it and reports the error against that line.
      writeFileSync(SYNTAX_FILE, 'export const x = 1;\nconst y = ;\n');

      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        validate({
          config: SYNTAX_CONFIG,
          verbose: false,
          update: false,
          compare: false,
        });
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      // The error is grouped under the file header (relative to rootDir) and
      // listed with its 0-indexed line, proving the parser offset was resolved
      // to a location rather than falling back to the "Global" bucket.
      expect(errorSpy).toHaveBeenCalledWith(`${join('src', 'broken.ts')}:`);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('1: Errors parsing file:')
      );
    });
  });

  // --compare reads the config and database from another branch via `git show`,
  // so unlike the other cases this project must be a real git repo. It commits a
  // baseline on `main`, then adds a new legacy id on `feature` that does not
  // exist on `main` -- exactly the drift --compare is meant to reject. This
  // drives the `if (compare)` branch of validate() end-to-end. Paths are
  // repo-relative and validate runs with the repo as cwd because `git show`
  // only accepts repo-relative paths.
  describe('with --compare', () => {
    const COMPARE_PROJECT = join(tmpdir(), 'lint-legacies-compare-project');
    const COMPARE_SRC = join(COMPARE_PROJECT, 'src');
    const COMPARE_FILE = join(COMPARE_SRC, 'uses.ts');
    const CONFIG_REL = 'legacy-lint.config.jsonc';
    const DATA_REL = 'legacy-lint.data.json';

    const COMPARE_CONFIG = {
      ignoreWarnings: false,
      pragma: DEFAULT_PRAGMA,
      databaseFile: DATA_REL,
      nonDisableableRules: [],
      compareBranch: 'main',
      linterType: 'eslint',
    };

    function git(args: string[]) {
      execFileSync('git', args, { cwd: COMPARE_PROJECT, stdio: 'pipe' });
    }

    function setup() {
      mkdirSync(COMPARE_SRC, { recursive: true });
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test']);
      writeFileSync(
        join(COMPARE_PROJECT, CONFIG_REL),
        JSON.stringify(COMPARE_CONFIG)
      );
      writeFileSync(join(COMPARE_PROJECT, DATA_REL), JSON.stringify([]));
      writeFileSync(COMPARE_FILE, 'export const noop = true;\n');
      git(['add', '-A']);
      git(['commit', '-m', 'baseline']);
      git(['checkout', '-b', 'feature']);

      // On feature, register a new legacy id (absent from main's database) plus a
      // matching source comment so it is found in code -- leaving the compare
      // check as the only error rather than an unregistered/unused-id error.
      writeFileSync(
        join(COMPARE_PROJECT, DATA_REL),
        JSON.stringify([['newid001', ['no-console']]])
      );
      writeFileSync(
        COMPARE_FILE,
        [
          'export function logSomething(): void {',
          `  // eslint-disable-next-line no-console -- ${DEFAULT_PRAGMA} (no-console) newid001`,
          "  console.log('x');",
          '}',
          '',
        ].join('\n')
      );
    }

    // validate resolves the repo-relative config path against cwd, so run it with
    // the repo as cwd. Restore in finally so a throw doesn't strand the suite.
    function runCompareValidate() {
      const originalCwd = process.cwd();
      process.chdir(COMPARE_PROJECT);
      try {
        validate({
          config: CONFIG_REL,
          verbose: false,
          update: false,
          compare: true,
        });
      } finally {
        process.chdir(originalCwd);
      }
    }

    afterEach(() => {
      rmSync(COMPARE_PROJECT, { recursive: true, force: true });
    });

    it('exits 1 and reports a new legacy id that is absent from the compare branch', () => {
      setup();
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => {
        runCompareValidate();
      }).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('does not exist in the database on main')
      );
    });
  });
});
