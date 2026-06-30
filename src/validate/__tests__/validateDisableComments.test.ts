import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../util/db.js';
import type {
  LegacyComment,
  NonLegacyComment,
  ValidationError,
} from '../../util/types.js';
import type { CompareInfo } from '../getCompareInfo.js';
import { validateDisableComments } from '../validateDisableComments.js';

function makeLegacy(overrides: Partial<LegacyComment> = {}): LegacyComment {
  return {
    type: 'legacy',
    file: 'test.ts',
    startLine: 1,
    endLine: 1,
    legaciedRules: ['no-console'],
    nonLegaciedRules: [],
    id: 'a1b2c3d4',
    ...overrides,
  };
}

function makeNonLegacy(
  overrides: Partial<NonLegacyComment> = {}
): NonLegacyComment {
  return {
    type: 'nonlegacy',
    file: 'test.ts',
    startLine: 1,
    endLine: 1,
    rules: ['no-console'],
    ...overrides,
  };
}

// Most tests only care about a few inputs; this wrapper fills the rest with inert
// defaults so each call can focus on the inputs it actually exercises.
function callValidate(
  overrides: Partial<Parameters<typeof validateDisableComments>[0]> = {}
) {
  return validateDisableComments({
    database: createDatabase({ filePath: undefined, databaseContents: [] }),
    nonDisableableRules: [],
    validationErrors: [],
    legacyComments: [],
    nonLegacyComments: [],
    compareData: undefined,
    ...overrides,
  });
}

describe('validateDisableComments', () => {
  describe('partitioning ids into used and unused', () => {
    it('returns empty arrays when the database is empty and there are no comments', () => {
      const result = callValidate();
      expect(result).toEqual({ usedIds: [], unusedIds: [] });
    });

    it('treats every database id as unused when there are no comments', () => {
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['id1', 'id2', 'id3'],
        }),
      });
      expect(result).toEqual({ usedIds: [], unusedIds: ['id1', 'id2', 'id3'] });
    });

    it('marks an id as used when a matching comment is found', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['id1', 'id2'],
        }),
        validationErrors,
        legacyComments: [makeLegacy({ id: 'id1' })],
      });
      expect(result).toEqual({ usedIds: ['id1'], unusedIds: ['id2'] });
      expect(validationErrors).toEqual([]);
    });

    it('returns used and unused ids in database order, not comment order', () => {
      // The database always provides its ids pre-sorted, and
      // validateDisableComments preserves that order, so the results come back
      // sorted regardless of the order in which the comments are encountered.
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['a', 'b', 'c', 'd'],
        }),
        legacyComments: [makeLegacy({ id: 'c' }), makeLegacy({ id: 'a' })],
      });
      expect(result).toEqual({ usedIds: ['a', 'c'], unusedIds: ['b', 'd'] });
    });
  });

  describe('unregistered legacy errors', () => {
    it('records an error when a comment id is not in the database', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['id1'],
        }),
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
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['dup', 'other'],
        }),
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
      callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['dup'],
        }),
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

  describe('comparing against a branch', () => {
    function makeCompareData(expectedIds: string[]): CompareInfo {
      return {
        expectedIds: new Set(expectedIds),
        compareBranchName: 'main',
      };
    }

    it('records a file:line error when a registered id is absent from the compare branch', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['new'],
        }),
        validationErrors,
        legacyComments: [
          makeLegacy({ id: 'new', file: 'src/a.ts', startLine: 7, endLine: 7 }),
        ],
        compareData: makeCompareData([]),
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Legacy ID "new" is not present in main. New legacied statements are not allowed',
          file: 'src/a.ts',
          line: 7,
        },
      ]);
      // A new-on-this-branch id is never marked used, so it lands in neither list.
      expect(result).toEqual({ usedIds: [], unusedIds: ['new'] });
    });

    it('passes ids that exist on both the database and the compare branch', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['known'],
        }),
        validationErrors,
        legacyComments: [makeLegacy({ id: 'known' })],
        compareData: makeCompareData(['known']),
      });
      expect(validationErrors).toEqual([]);
      expect(result).toEqual({ usedIds: ['known'], unusedIds: [] });
    });

    it('flags only the ids missing from the compare branch', () => {
      const validationErrors: ValidationError[] = [];
      callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['old', 'new'],
        }),
        validationErrors,
        legacyComments: [
          makeLegacy({ id: 'old', file: 'a.ts', startLine: 1, endLine: 1 }),
          makeLegacy({ id: 'new', file: 'b.ts', startLine: 2, endLine: 2 }),
        ],
        compareData: makeCompareData(['old']),
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Legacy ID "new" is not present in main. New legacied statements are not allowed',
          file: 'b.ts',
          line: 2,
        },
      ]);
    });
  });

  describe('non-disableable rules', () => {
    it('records an error when a non-legacy comment disables a non-disableable rule', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        nonDisableableRules: ['no-console'],
        validationErrors,
        nonLegacyComments: [
          makeNonLegacy({ file: 'src/a.ts', startLine: 5, endLine: 5 }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message: 'Rule "no-console" cannot be disabled.',
          file: 'src/a.ts',
          line: 5,
        },
      ]);
      // Non-legacy comments never participate in id partitioning.
      expect(result).toEqual({ usedIds: [], unusedIds: [] });
    });

    it('records no error when a non-legacy comment disables a rule that is not non-disableable', () => {
      const validationErrors: ValidationError[] = [];
      callValidate({
        nonDisableableRules: ['no-debugger'],
        validationErrors,
        nonLegacyComments: [makeNonLegacy({ rules: ['no-console'] })],
      });
      expect(validationErrors).toEqual([]);
    });

    it('flags nothing when the non-disableable list is empty', () => {
      const validationErrors: ValidationError[] = [];
      callValidate({
        validationErrors,
        nonLegacyComments: [makeNonLegacy({ rules: ['no-console'] })],
      });
      expect(validationErrors).toEqual([]);
    });

    it('records one error per non-disableable rule disabled by a single comment', () => {
      const validationErrors: ValidationError[] = [];
      callValidate({
        nonDisableableRules: ['no-console', 'no-debugger'],
        validationErrors,
        nonLegacyComments: [
          makeNonLegacy({
            rules: ['no-console', 'no-debugger', 'no-alert'],
            file: 'a.ts',
            startLine: 3,
            endLine: 3,
          }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message: 'Rule "no-console" cannot be disabled.',
          file: 'a.ts',
          line: 3,
        },
        {
          message: 'Rule "no-debugger" cannot be disabled.',
          file: 'a.ts',
          line: 3,
        },
      ]);
    });

    it('records an error per offending comment across several comments', () => {
      const validationErrors: ValidationError[] = [];
      callValidate({
        nonDisableableRules: ['no-console'],
        validationErrors,
        nonLegacyComments: [
          makeNonLegacy({ file: 'a.ts', startLine: 1, endLine: 1 }),
          makeNonLegacy({
            rules: ['no-debugger'],
            file: 'b.ts',
            startLine: 2,
            endLine: 2,
          }),
          makeNonLegacy({ file: 'c.ts', startLine: 3, endLine: 3 }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message: 'Rule "no-console" cannot be disabled.',
          file: 'a.ts',
          line: 1,
        },
        {
          message: 'Rule "no-console" cannot be disabled.',
          file: 'c.ts',
          line: 3,
        },
      ]);
    });

    it('flags a non-disableable rule disabled fresh alongside a legacy pragma', () => {
      // A single directive can legacy one rule while disabling another outright.
      // The non-legacied rule is a new disable and must still be caught.
      const validationErrors: ValidationError[] = [];
      callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['a1b2c3d4'],
        }),
        nonDisableableRules: ['no-debugger'],
        validationErrors,
        legacyComments: [
          makeLegacy({
            legaciedRules: ['no-console'],
            nonLegaciedRules: ['no-debugger'],
            file: 'src/a.ts',
            startLine: 8,
            endLine: 8,
          }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message: 'Rule "no-debugger" cannot be disabled.',
          file: 'src/a.ts',
          line: 8,
        },
      ]);
    });

    it('exempts a non-disableable rule that is legacied (old violations are allowed)', () => {
      // The whole point of the legacy system: a grandfathered violation of a
      // non-disableable rule is permitted, only new ones are rejected.
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['a1b2c3d4'],
        }),
        nonDisableableRules: ['no-console'],
        validationErrors,
        legacyComments: [
          makeLegacy({ legaciedRules: ['no-console'], nonLegaciedRules: [] }),
        ],
      });
      expect(validationErrors).toEqual([]);
      expect(result).toEqual({ usedIds: ['a1b2c3d4'], unusedIds: [] });
    });

    it('appends non-disableable errors without clobbering existing ones', () => {
      const validationErrors: ValidationError[] = [
        { message: 'pre-existing', file: 'x.ts', line: 9 },
      ];
      callValidate({
        nonDisableableRules: ['no-console'],
        validationErrors,
        nonLegacyComments: [
          makeNonLegacy({ file: 'y.ts', startLine: 10, endLine: 10 }),
        ],
      });
      expect(validationErrors).toEqual([
        { message: 'pre-existing', file: 'x.ts', line: 9 },
        {
          message: 'Rule "no-console" cannot be disabled.',
          file: 'y.ts',
          line: 10,
        },
      ]);
    });
  });

  describe('combined scenarios', () => {
    it('handles used, unused, unregistered, and duplicate ids together', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['dup', 'unused', 'used'],
        }),
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
      callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: ['id1'],
        }),
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
