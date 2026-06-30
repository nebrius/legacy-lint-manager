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

// The data file is now a bare array of ids.
function readDataIds(): string[] {
  return JSON.parse(readFileSync(WORKING_DATA, 'utf-8')) as string[];
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
    expect(readDataIds()).toEqual(['c0nsole1', 'debugg02']);
  });

  describe('when a legacied error was fixed (an unused id remains)', () => {
    it('rewrites the database with only the used ids when --update is set', () => {
      writeConfig();
      useDatabase('has-unused.json');
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      runValidate(true);
      expect(readDataIds()).toEqual(['c0nsole1', 'debugg02']);
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
      expect(readDataIds()).toEqual(['c0nsole1', 'debugg02', 'unused01']);
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
    expect(errorSpy).toHaveBeenCalledWith('Validation errors:');
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
      expect(errorSpy).toHaveBeenCalledWith('Validation errors:');
      // The comment is on the visually-2nd line, but validate prints the
      // 0-indexed startLine verbatim, so the header reads `:1` (an off-by-one
      // in the user-facing output).
      expect(errorSpy).toHaveBeenCalledWith(`${MALFORMED_FILE}:1`);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Malformed legacy comment:')
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
      expect(errorSpy).toHaveBeenCalledWith('Validation errors:');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rule "no-console" cannot be disabled.')
      );
    });
  });
});
