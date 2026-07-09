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
    it('loads the id/rules pairs from a valid database file', () => {
      const database = readDatabase(databasePath('valid.json'));
      expect(database.getIds()).toEqual(
        new Map([
          ['18gh38s60000', ['no-console']],
          ['abc123450000', ['no-debugger']],
          ['xyz987650000', ['no-console']],
        ])
      );
    });

    it('loads a database file with an empty ids array', () => {
      const database = readDatabase(databasePath('empty.json'));
      expect(database.getIds()).toEqual(new Map());
    });

    it('preserves the on-disk order when loading (sorting happens at save time)', () => {
      const database = readDatabase(databasePath('unsorted-ids.json'));
      expect([...database.getIds().keys()]).toEqual([
        'm5x9q2w10000',
        'z9y8x7w60000',
        'a1b2c3d40000',
      ]);
    });

    describe('with an invalid database file', () => {
      it('throws when a rule entry is not a string', () => {
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
    it('builds an instance from in-memory tuples, preserving their order', () => {
      const database = createDatabase({
        filePath: undefined,
        databaseContents: [
          ['zebra', ['no-console']],
          ['apple', ['no-debugger']],
        ],
      });
      expect(database.getIds()).toEqual(
        new Map([
          ['zebra', ['no-console']],
          ['apple', ['no-debugger']],
        ])
      );
    });

    it('throws when the contents are invalid', () => {
      expect(() =>
        createDatabase({
          filePath: undefined,
          databaseContents: [['id', [42]]],
        })
      ).toThrow('Invalid database file: must be string');
    });
  });

  describe('setIds', () => {
    it('replaces the ids returned by getIds', () => {
      const database = readDatabase(databasePath('valid.json'));
      database.setIds(
        new Map([
          ['zebra', ['no-console']],
          ['apple', ['no-debugger']],
        ])
      );
      expect(database.getIds()).toEqual(
        new Map([
          ['zebra', ['no-console']],
          ['apple', ['no-debugger']],
        ])
      );
    });

    it('can clear all ids', () => {
      const database = readDatabase(databasePath('valid.json'));
      database.setIds(new Map());
      expect(database.getIds()).toEqual(new Map());
    });
  });

  describe('save', () => {
    afterEach(() => {
      rmSync(WORKING_DB, { force: true });
    });

    it('persists the ids to disk as sorted tuples a fresh Database re-reads', () => {
      cpSync(databasePath('valid.json'), WORKING_DB);
      const database = readDatabase(WORKING_DB);
      database.setIds(
        new Map([
          ['new2', ['no-console']],
          ['new1', ['no-debugger']],
        ])
      );
      database.save();

      // save() sorts the entries by id, so both the raw file and a freshly
      // constructed Database come back in sorted-id order.
      expect(JSON.parse(readFileSync(WORKING_DB, 'utf-8'))).toEqual([
        ['new1', ['no-debugger']],
        ['new2', ['no-console']],
      ]);
      expect(readDatabase(WORKING_DB).getIds()).toEqual(
        new Map([
          ['new1', ['no-debugger']],
          ['new2', ['no-console']],
        ])
      );
    });

    it('sorts each entry’s rules when saving', () => {
      cpSync(databasePath('valid.json'), WORKING_DB);
      const database = readDatabase(WORKING_DB);
      database.setIds(new Map([['id1', ['no-debugger', 'no-console']]]));
      database.save();

      expect(JSON.parse(readFileSync(WORKING_DB, 'utf-8'))).toEqual([
        ['id1', ['no-console', 'no-debugger']],
      ]);
    });

    it('persists an empty ids array', () => {
      cpSync(databasePath('valid.json'), WORKING_DB);
      const database = readDatabase(WORKING_DB);
      database.setIds(new Map());
      database.save();

      expect(readDatabase(WORKING_DB).getIds()).toEqual(new Map());
      expect(JSON.parse(readFileSync(WORKING_DB, 'utf-8'))).toEqual([]);
    });
  });
});
