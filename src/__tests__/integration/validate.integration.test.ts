import { cpSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRAGMA } from '../../types.js';
import { validate } from '../../validate/validate.js';

const INTEGRATION_DIR = import.meta.dirname;
const PROJECT_DIR = join(INTEGRATION_DIR, 'fixtures', 'project');
const DATABASES_DIR = join(INTEGRATION_DIR, 'fixtures', 'databases');

// The working database lives at the root of the sample project (mirroring how
// it sits relative to the code in real usage) and is gitignored, so mutating
// it during the --update test never dirties the repo.
const WORKING_DB = join(PROJECT_DIR, 'lint-legacies.json');

function useDatabase(scenario: string) {
  cpSync(join(DATABASES_DIR, scenario), WORKING_DB);
}

function readDatabase(): { ids: string[] } {
  return JSON.parse(readFileSync(WORKING_DB, 'utf-8')) as { ids: string[] };
}

function runValidate(update: boolean) {
  validate({
    databaseFile: WORKING_DB,
    rootDir: PROJECT_DIR,
    pragma: DEFAULT_PRAGMA,
    verbose: false,
    update,
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
    rmSync(WORKING_DB, { force: true });
  });

  it('passes cleanly when every database id is found in code', () => {
    useDatabase('all-used.json');
    expect(() => {
      runValidate(false);
    }).not.toThrow();
    // The database is left untouched on a clean run.
    expect(readDatabase()).toEqual({ ids: ['c0nsole1', 'debugg02'] });
  });

  describe('when a legacied error was fixed (an unused id remains)', () => {
    it('rewrites the database with only the used ids when --update is set', () => {
      useDatabase('has-unused.json');
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      runValidate(true);
      expect(readDatabase()).toEqual({ ids: ['c0nsole1', 'debugg02'] });
    });

    it('exits with an error and leaves the database untouched without --update', () => {
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
      expect(readDatabase()).toEqual({
        ids: ['c0nsole1', 'debugg02', 'unused01'],
      });
    });
  });

  it('exits with an error when code references an unregistered id', () => {
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
});
