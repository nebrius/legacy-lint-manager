import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Database } from '../db.js';

const DATABASE_ROOT = join(import.meta.dirname, 'databases');

function databasePath(fixture: string): string {
  return join(DATABASE_ROOT, fixture);
}

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
  });

  describe('getIds', () => {
    it('returns the ids held in memory', () => {
      const database = new Database(databasePath('valid.json'));
      expect(database.getIds()).toEqual(['18gh38s6', 'abc12345', 'xyz98765']);
    });
  });

  describe('setIds', () => {
    it('replaces the ids returned by getIds', () => {
      const database = new Database(databasePath('valid.json'));
      database.setIds(['new1', 'new2']);
      expect(database.getIds()).toEqual(['new1', 'new2']);
    });

    it('can clear all ids', () => {
      const database = new Database(databasePath('valid.json'));
      database.setIds([]);
      expect(database.getIds()).toEqual([]);
    });
  });
});
