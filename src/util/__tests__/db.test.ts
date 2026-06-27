import { cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDatabase, readDatabase } from '../db.js';

const DATABASE_ROOT = join(import.meta.dirname, 'databases');

function databasePath(fixture: string): string {
  return join(DATABASE_ROOT, fixture);
}

// save() writes to disk; route it through the OS temp dir so a successful run
// never dirties the repo and never collides with getFileList's gitignore tests.
const WORKING_DB = join(tmpdir(), 'lint-legacies-db-roundtrip.json');

// A path that must stay absent so readDatabase takes its "does not exist" branch.
const MISSING_DB = join(tmpdir(), 'lint-legacies-db-missing.json');

describe('Database', () => {
  describe('readDatabase', () => {
    it('loads the ids from a valid database file', () => {
      const database = readDatabase(databasePath('valid.json'));
      expect(database.getIds()).toEqual(['18gh38s6', 'abc12345', 'xyz98765']);
    });

    it('loads a database file with an empty ids array', () => {
      const database = readDatabase(databasePath('empty.json'));
      expect(database.getIds()).toEqual([]);
    });

    it('sorts the ids when loading the database file', () => {
      const database = readDatabase(databasePath('unsorted-ids.json'));
      expect(database.getIds()).toEqual(['a1b2c3d4', 'm5x9q2w1', 'z9y8x7w6']);
    });

    describe('with an invalid database file', () => {
      it('throws when the array contains a non-string', () => {
        expect(() => readDatabase(databasePath('non-string-ids.json'))).toThrow(
          'Invalid database file: must be string'
        );
      });

      it('throws when the root is not an array', () => {
        expect(() => readDatabase(databasePath('not-an-array.json'))).toThrow(
          'Invalid database file: must be array'
        );
      });
    });

    describe('with a nonexistent database file', () => {
      afterEach(() => {
        rmSync(MISSING_DB, { force: true });
        vi.restoreAllMocks();
      });

      it('logs an error and exits without creating the file', () => {
        rmSync(MISSING_DB, { force: true });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
          throw new Error('process.exit called');
        });
        const errorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);

        expect(() => readDatabase(MISSING_DB)).toThrow('process.exit called');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('does not exist')
        );
      });
    });
  });

  describe('createDatabase', () => {
    it('builds an instance from an in-memory array, sorting the ids', () => {
      const database = createDatabase({
        filePath: undefined,
        databaseContents: ['zebra', 'apple'],
      });
      expect(database.getIds()).toEqual(['apple', 'zebra']);
    });

    it('throws when the contents are invalid', () => {
      expect(() =>
        createDatabase({ filePath: undefined, databaseContents: [42] })
      ).toThrow('Invalid database file: must be string');
    });
  });

  describe('setIds', () => {
    it('replaces the ids returned by getIds, re-sorting them', () => {
      const database = readDatabase(databasePath('valid.json'));
      database.setIds(['zebra', 'apple']);
      expect(database.getIds()).toEqual(['apple', 'zebra']);
    });

    it('can clear all ids', () => {
      const database = readDatabase(databasePath('valid.json'));
      database.setIds([]);
      expect(database.getIds()).toEqual([]);
    });
  });

  describe('save', () => {
    afterEach(() => {
      rmSync(WORKING_DB, { force: true });
    });

    it('persists the in-memory ids to disk as a bare array a fresh Database re-reads', () => {
      cpSync(databasePath('valid.json'), WORKING_DB);
      const database = readDatabase(WORKING_DB);
      database.setIds(['new2', 'new1']);
      database.save();

      // A freshly-constructed Database reads exactly what was written (both the
      // load and setIds paths sort, so assert against the sorted form).
      expect(readDatabase(WORKING_DB).getIds()).toEqual(['new1', 'new2']);
      expect(JSON.parse(readFileSync(WORKING_DB, 'utf-8'))).toEqual([
        'new1',
        'new2',
      ]);
    });

    it('persists an empty ids array', () => {
      cpSync(databasePath('valid.json'), WORKING_DB);
      const database = readDatabase(WORKING_DB);
      database.setIds([]);
      database.save();

      expect(readDatabase(WORKING_DB).getIds()).toEqual([]);
      expect(JSON.parse(readFileSync(WORKING_DB, 'utf-8'))).toEqual([]);
    });
  });
});
