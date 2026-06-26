import { cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fromFile } from '../db.js';

const DATABASE_ROOT = join(import.meta.dirname, 'databases');

function databasePath(fixture: string): string {
  return join(DATABASE_ROOT, fixture);
}

// save() writes to disk; route it through the OS temp dir so a successful run
// never dirties the repo and never collides with getFileList's gitignore tests.
const WORKING_DB = join(tmpdir(), 'lint-legacies-db-roundtrip.json');

// A path that must be absent so the constructor takes its "create a new
// database" branch. It can't be a committed fixture (the test relies on the
// file not existing), and save() will create it, so it lives in the temp dir
// and is removed after each test.
const MISSING_DB = join(tmpdir(), 'lint-legacies-db-missing.json');

describe('Database', () => {
  describe('constructor', () => {
    it('loads the ids from a valid database file', () => {
      const database = fromFile({
        databaseFile: databasePath('valid.json'),
        createIfMissing: false,
      });
      expect(database.getIds()).toEqual(['18gh38s6', 'abc12345', 'xyz98765']);
    });

    it('loads a database file with an empty ids array', () => {
      const database = fromFile({
        databaseFile: databasePath('empty.json'),
        createIfMissing: false,
      });
      expect(database.getIds()).toEqual([]);
    });

    it('sorts the ids when loading the database file', () => {
      const database = fromFile({
        databaseFile: databasePath('unsorted-ids.json'),
        createIfMissing: false,
      });
      expect(database.getIds()).toEqual(['a1b2c3d4', 'm5x9q2w1', 'z9y8x7w6']);
    });

    describe('with an invalid database file', () => {
      it('appends the single validation error inline when ids contains a non-string', () => {
        expect(() =>
          fromFile({
            databaseFile: databasePath('non-string-ids.json'),
            createIfMissing: false,
          })
        ).toThrow('Invalid database file: must be string');
      });

      it('appends the single validation error inline when the root is not an object', () => {
        expect(() =>
          fromFile({
            databaseFile: databasePath('not-an-object.json'),
            createIfMissing: false,
          })
        ).toThrow('Invalid database file: must be object');
      });

      it('appends the single validation error inline when there are additional properties', () => {
        expect(() =>
          fromFile({
            databaseFile: databasePath('additional-properties.json'),
            createIfMissing: false,
          })
        ).toThrow('Invalid database file: must not have additional properties');
      });

      it('lists every validation error on its own line when there are multiple', () => {
        expect(() =>
          fromFile({
            databaseFile: databasePath('missing-ids.json'),
            createIfMissing: false,
          })
        ).toThrow(
          'Invalid database file:\n  must have required properties ids\n  must not have additional properties'
        );
      });
    });

    describe('with a nonexistent database file', () => {
      afterEach(() => {
        rmSync(MISSING_DB, { force: true });
        vi.restoreAllMocks();
      });

      describe('and createIfMissing is true', () => {
        it('initializes an empty ids array when the file does not exist', () => {
          rmSync(MISSING_DB, { force: true });
          const database = fromFile({
            databaseFile: MISSING_DB,
            createIfMissing: true,
          });
          expect(database.getIds()).toEqual([]);
        });

        it('can be populated, saved (creating the file), and re-read', () => {
          rmSync(MISSING_DB, { force: true });
          const database = fromFile({
            databaseFile: MISSING_DB,
            createIfMissing: true,
          });
          database.setIds(['new2', 'new1']);
          database.save();

          // The freshly-created file reads back exactly what was written. The
          // load path sorts on construction, so assert against the sorted form.
          expect(
            fromFile({
              databaseFile: MISSING_DB,
              createIfMissing: true,
            }).getIds()
          ).toEqual(['new1', 'new2']);
          expect(JSON.parse(readFileSync(MISSING_DB, 'utf-8'))).toEqual({
            ids: ['new2', 'new1'],
          });
        });
      });

      describe('and createIfMissing is false', () => {
        it('logs an error and exits without creating the file', () => {
          rmSync(MISSING_DB, { force: true });
          const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit called');
          });
          const errorSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

          expect(() =>
            fromFile({ databaseFile: MISSING_DB, createIfMissing: false })
          ).toThrow('process.exit called');
          expect(exitSpy).toHaveBeenCalledWith(1);
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('does not exist')
          );
        });
      });
    });
  });

  describe('getIds', () => {
    it('returns the ids held in memory', () => {
      const database = fromFile({
        databaseFile: databasePath('valid.json'),
        createIfMissing: false,
      });
      expect(database.getIds()).toEqual(['18gh38s6', 'abc12345', 'xyz98765']);
    });
  });

  describe('setIds', () => {
    it('replaces the ids returned by getIds without re-sorting them', () => {
      const database = fromFile({
        databaseFile: databasePath('valid.json'),
        createIfMissing: false,
      });
      database.setIds(['zebra', 'apple']);
      expect(database.getIds()).toEqual(['zebra', 'apple']);
    });

    it('can clear all ids', () => {
      const database = fromFile({
        databaseFile: databasePath('valid.json'),
        createIfMissing: false,
      });
      database.setIds([]);
      expect(database.getIds()).toEqual([]);
    });
  });

  describe('save', () => {
    afterEach(() => {
      rmSync(WORKING_DB, { force: true });
    });

    it('persists the in-memory ids back to disk as a fresh Database can re-read', () => {
      cpSync(databasePath('valid.json'), WORKING_DB);
      const database = fromFile({
        databaseFile: WORKING_DB,
        createIfMissing: false,
      });
      database.setIds(['new1', 'new2']);
      database.save();

      // A freshly-constructed Database reads exactly what was written (the
      // constructor sorts on load, so assert against the sorted form).
      expect(
        fromFile({ databaseFile: WORKING_DB, createIfMissing: false }).getIds()
      ).toEqual(['new1', 'new2']);
      expect(JSON.parse(readFileSync(WORKING_DB, 'utf-8'))).toEqual({
        ids: ['new1', 'new2'],
      });
    });

    it('persists an empty ids array', () => {
      cpSync(databasePath('valid.json'), WORKING_DB);
      const database = fromFile({
        databaseFile: WORKING_DB,
        createIfMissing: false,
      });
      database.setIds([]);
      database.save();

      expect(
        fromFile({ databaseFile: WORKING_DB, createIfMissing: false }).getIds()
      ).toEqual([]);
    });
  });
});
