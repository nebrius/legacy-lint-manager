import { describe, expect, it } from 'vitest';

import type { LegacyComment, ValidationError } from '../../types.js';
import { fromContents } from '../../util/db.js';
import { validateIds } from '../validateIds.js';

function makeLegacy(overrides: Partial<LegacyComment> = {}): LegacyComment {
  return {
    file: 'test.ts',
    startLine: 1,
    endLine: 1,
    rules: ['no-console'],
    id: 'a1b2c3d4',
    ...overrides,
  };
}

describe('validateIds', () => {
  describe('partitioning ids into used and unused', () => {
    it('returns empty arrays when the database is empty and there are no comments', () => {
      const result = validateIds({
        database: fromContents({ ids: [] }),
        validationErrors: [],
        legacyComments: [],
      });
      expect(result).toEqual({ usedIds: [], unusedIds: [] });
    });

    it('treats every database id as unused when there are no comments', () => {
      const result = validateIds({
        database: fromContents({ ids: ['id1', 'id2', 'id3'] }),
        validationErrors: [],
        legacyComments: [],
      });
      expect(result).toEqual({ usedIds: [], unusedIds: ['id1', 'id2', 'id3'] });
    });

    it('marks an id as used when a matching comment is found', () => {
      const validationErrors: ValidationError[] = [];
      const result = validateIds({
        database: fromContents({ ids: ['id1', 'id2'] }),
        validationErrors,
        legacyComments: [makeLegacy({ id: 'id1' })],
      });
      expect(result).toEqual({ usedIds: ['id1'], unusedIds: ['id2'] });
      expect(validationErrors).toEqual([]);
    });

    it('returns used and unused ids in database order, not comment order', () => {
      // The database always provides its ids pre-sorted, and validateIds
      // preserves that order, so the results come back sorted regardless of the
      // order in which the comments are encountered.
      const result = validateIds({
        database: fromContents({ ids: ['a', 'b', 'c', 'd'] }),
        validationErrors: [],
        legacyComments: [makeLegacy({ id: 'c' }), makeLegacy({ id: 'a' })],
      });
      expect(result).toEqual({ usedIds: ['a', 'c'], unusedIds: ['b', 'd'] });
    });
  });

  describe('unregistered legacy errors', () => {
    it('records an error when a comment id is not in the database', () => {
      const validationErrors: ValidationError[] = [];
      const result = validateIds({
        database: fromContents({ ids: ['id1'] }),
        validationErrors,
        legacyComments: [
          makeLegacy({
            id: 'unknown',
            file: 'src/a.ts',
            startLine: 12,
            endLine: 12,
          }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message: 'Unregistered legacy error. New errors cannot be legacied.',
          file: 'src/a.ts',
          line: 12,
        },
      ]);
      // An unregistered id never enters the database map, so it appears in
      // neither the used nor unused lists.
      expect(result).toEqual({ usedIds: [], unusedIds: ['id1'] });
    });
  });

  describe('duplicate legacy ids', () => {
    it('records an error for the second use of the same id', () => {
      const validationErrors: ValidationError[] = [];
      const result = validateIds({
        database: fromContents({ ids: ['dup', 'other'] }),
        validationErrors,
        legacyComments: [
          makeLegacy({ id: 'dup', file: 'a.ts', startLine: 1, endLine: 1 }),
          makeLegacy({ id: 'dup', file: 'b.ts', startLine: 2, endLine: 2 }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Duplicate legacy ID "dup". Each legacy ID can only be used once.',
          file: 'b.ts',
          line: 2,
        },
      ]);
      // A duplicated id is still counted as used exactly once.
      expect(result).toEqual({ usedIds: ['dup'], unusedIds: ['other'] });
    });

    it('records an error for every use beyond the first', () => {
      const validationErrors: ValidationError[] = [];
      validateIds({
        database: fromContents({ ids: ['dup'] }),
        validationErrors,
        legacyComments: [
          makeLegacy({ id: 'dup', file: 'a.ts', startLine: 1, endLine: 1 }),
          makeLegacy({ id: 'dup', file: 'b.ts', startLine: 2, endLine: 2 }),
          makeLegacy({ id: 'dup', file: 'c.ts', startLine: 3, endLine: 3 }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Duplicate legacy ID "dup". Each legacy ID can only be used once.',
          file: 'b.ts',
          line: 2,
        },
        {
          message:
            'Duplicate legacy ID "dup". Each legacy ID can only be used once.',
          file: 'c.ts',
          line: 3,
        },
      ]);
    });
  });

  describe('combined scenarios', () => {
    it('handles used, unused, unregistered, and duplicate ids together', () => {
      const validationErrors: ValidationError[] = [];
      const result = validateIds({
        database: fromContents({ ids: ['dup', 'unused', 'used'] }),
        validationErrors,
        legacyComments: [
          makeLegacy({ id: 'used', file: 'a.ts', startLine: 1, endLine: 1 }),
          makeLegacy({ id: 'dup', file: 'b.ts', startLine: 2, endLine: 2 }),
          makeLegacy({ id: 'dup', file: 'c.ts', startLine: 3, endLine: 3 }),
          makeLegacy({ id: 'ghost', file: 'd.ts', startLine: 4, endLine: 4 }),
        ],
      });
      expect(result).toEqual({
        usedIds: ['dup', 'used'],
        unusedIds: ['unused'],
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Duplicate legacy ID "dup". Each legacy ID can only be used once.',
          file: 'c.ts',
          line: 3,
        },
        {
          message: 'Unregistered legacy error. New errors cannot be legacied.',
          file: 'd.ts',
          line: 4,
        },
      ]);
    });

    it('appends to existing validation errors without clobbering them', () => {
      const validationErrors: ValidationError[] = [
        { message: 'pre-existing', file: 'x.ts', line: 9 },
      ];
      validateIds({
        database: fromContents({ ids: ['id1'] }),
        validationErrors,
        legacyComments: [
          makeLegacy({ id: 'ghost', file: 'y.ts', startLine: 10, endLine: 10 }),
        ],
      });
      expect(validationErrors).toEqual([
        { message: 'pre-existing', file: 'x.ts', line: 9 },
        {
          message: 'Unregistered legacy error. New errors cannot be legacied.',
          file: 'y.ts',
          line: 10,
        },
      ]);
    });
  });
});
