import { cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Database } from '../db.js';

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
      const database = new Database(databasePath('valid.json'));
      expect(database.getIds()).toEqual(['18gh38s6', 'abc12345', 'xyz98765']);
    });

    it('loads a database file with an empty ids array', () => {
      const database = new Database(databasePath('empty.json'));
      expect(database.getIds()).toEqual([]);
    });

    it('sorts the ids when loading the database file', () => {
      const database = new Database(databasePath('unsorted-ids.json'));
      expect(database.getIds()).toEqual(['a1b2c3d4', 'm5x9q2w1', 'z9y8x7w6']);
    });

    describe('with an invalid database file', () => {
      it('appends the single validation error inline when ids contains a non-string', () => {
        expect(() => new Database(databasePath('non-string-ids.json'))).toThrow(
          'Invalid database file: must be string'
        );
      });

      it('appends the single validation error inline when the root is not an object', () => {
        expect(() => new Database(databasePath('not-an-object.json'))).toThrow(
          'Invalid database file: must be object'
        );
      });

      it('appends the single validation error inline when there are additional properties', () => {
        expect(
          () => new Database(databasePath('additional-properties.json'))
        ).toThrow('Invalid database file: must not have additional properties');
      });

      it('lists every validation error on its own line when there are multiple', () => {
        expect(() => new Database(databasePath('missing-ids.json'))).toThrow(
          'Invalid database file:\n  must have required properties ids\n  must not have additional properties'
        );
      });
    });

    describe('with a nonexistent database file', () => {
      afterEach(() => {
        rmSync(MISSING_DB, { force: true });
      });

      it('initializes an empty ids array when the file does not exist', () => {
        rmSync(MISSING_DB, { force: true });
        const database = new Database(MISSING_DB);
        expect(database.getIds()).toEqual([]);
      });

      it('can be populated, saved (creating the file), and re-read', () => {
        rmSync(MISSING_DB, { force: true });
        const database = new Database(MISSING_DB);
        database.setIds(['new2', 'new1']);
        database.save();

        // The freshly-created file reads back exactly what was written. The
        // load path sorts on construction, so assert against the sorted form.
        expect(new Database(MISSING_DB).getIds()).toEqual(['new1', 'new2']);
        expect(JSON.parse(readFileSync(MISSING_DB, 'utf-8'))).toEqual({
          ids: ['new2', 'new1'],
        });
      });
    });
  });

  describe('getIds', () => {
    it('returns the ids held in memory', () => {
      const database = new Database(databasePath('valid.json'));
      expect(database.getIds()).toEqual(['18gh38s6', 'abc12345', 'xyz98765']);
    });
  });

  describe('setIds', () => {
    it('replaces the ids returned by getIds without re-sorting them', () => {
      const database = new Database(databasePath('valid.json'));
      database.setIds(['zebra', 'apple']);
      expect(database.getIds()).toEqual(['zebra', 'apple']);
    });

    it('can clear all ids', () => {
      const database = new Database(databasePath('valid.json'));
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
      const database = new Database(WORKING_DB);
      database.setIds(['new1', 'new2']);
      database.save();

      // A freshly-constructed Database reads exactly what was written (the
      // constructor sorts on load, so assert against the sorted form).
      expect(new Database(WORKING_DB).getIds()).toEqual(['new1', 'new2']);
      expect(JSON.parse(readFileSync(WORKING_DB, 'utf-8'))).toEqual({
        ids: ['new1', 'new2'],
      });
    });

    it('persists an empty ids array', () => {
      cpSync(databasePath('valid.json'), WORKING_DB);
      const database = new Database(WORKING_DB);
      database.setIds([]);
      database.save();

      expect(new Database(WORKING_DB).getIds()).toEqual([]);
    });
  });
});
