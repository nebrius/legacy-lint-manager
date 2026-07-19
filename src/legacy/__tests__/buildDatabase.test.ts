import { describe, expect, it } from 'vitest';

import { makeId } from '../../__tests__/helpers/ids.js';
import type { LegacyComment, ValidationError } from '../../util/types.js';
import { buildDatabase } from '../buildDatabase.js';

// Build a minimal LegacyComment. Only id, legaciedRules, file, and startLine
// matter to buildDatabase; the rest are filled with sensible defaults so callers
// only pass what a case actually exercises.
function legacyComment({
  id,
  legaciedRules,
  file = '/repo/src/app.ts',
  startLine = 1,
  endLine = startLine,
  nonLegaciedRules = [],
}: {
  id: string;
  legaciedRules: string[];
  file?: string;
  startLine?: number;
  endLine?: number;
  nonLegaciedRules?: string[];
}): LegacyComment {
  return {
    type: 'legacy',
    id,
    legaciedRules,
    nonLegaciedRules,
    // buildDatabase never reads the index fields; arbitrary values satisfy the
    // comment shape
    unusedLegaciedRules: [],
    startIndex: 2,
    endIndex: 130,
    descriptionStartIndex: 30,
    legaciedRulesStartIndex: 80,
    legaciedRulesEndIndex: 95,
    file,
    startLine,
    endLine,
  };
}

describe('buildDatabase', () => {
  it('maps each id to its legacied rules as database tuples in insertion order', () => {
    const validationErrors: ValidationError[] = [];
    const databaseContents = buildDatabase({
      legacyComments: [
        legacyComment({ id: makeId('zebra'), legaciedRules: ['no-console'] }),
        legacyComment({
          id: makeId('apple'),
          legaciedRules: ['no-debugger', 'no-var'],
        }),
      ],
      validationErrors,
    });

    // Tuples come straight from the Map's insertion order; sorting happens later
    // at save time, not here.
    expect(databaseContents).toEqual([
      [makeId('zebra'), ['no-console']],
      [makeId('apple'), ['no-debugger', 'no-var']],
    ]);
    expect(validationErrors).toEqual([]);
  });

  it('returns an empty database and no errors for no legacy comments', () => {
    const validationErrors: ValidationError[] = [];
    expect(buildDatabase({ legacyComments: [], validationErrors })).toEqual([]);
    expect(validationErrors).toEqual([]);
  });

  it('does not flag distinct ids as duplicates', () => {
    const validationErrors: ValidationError[] = [];
    buildDatabase({
      legacyComments: [
        legacyComment({ id: makeId('one'), legaciedRules: ['no-console'] }),
        legacyComment({ id: makeId('two'), legaciedRules: ['no-debugger'] }),
      ],
      validationErrors,
    });
    expect(validationErrors).toEqual([]);
  });

  it('reports a duplicate id and keeps the last entry’s rules', () => {
    const validationErrors: ValidationError[] = [];
    const databaseContents = buildDatabase({
      legacyComments: [
        legacyComment({
          id: makeId('dupe'),
          legaciedRules: ['no-console'],
          file: '/repo/src/first.ts',
          startLine: 3,
        }),
        legacyComment({
          id: makeId('dupe'),
          legaciedRules: ['no-debugger'],
          file: '/repo/src/second.ts',
          startLine: 7,
        }),
      ],
      validationErrors,
    });

    // The duplicate is reported once, anchored at the second (colliding)
    // comment's location.
    expect(validationErrors).toEqual([
      {
        message: `Duplicate legacy ID "${makeId('dupe')}". Each legacy ID can only be used once.`,
        location: { file: '/repo/src/second.ts', line: 7 },
      },
    ]);
    // Map.set means the later entry wins, so the surviving tuple carries the
    // second comment's rules.
    expect(databaseContents).toEqual([[makeId('dupe'), ['no-debugger']]]);
  });

  it('reports one error per occurrence past the first when an id is used three times', () => {
    const validationErrors: ValidationError[] = [];
    buildDatabase({
      legacyComments: [
        legacyComment({
          id: makeId('dupe'),
          legaciedRules: ['no-console'],
          file: '/repo/src/first.ts',
          startLine: 1,
        }),
        legacyComment({
          id: makeId('dupe'),
          legaciedRules: ['no-debugger'],
          file: '/repo/src/second.ts',
          startLine: 2,
        }),
        legacyComment({
          id: makeId('dupe'),
          legaciedRules: ['no-var'],
          file: '/repo/src/third.ts',
          startLine: 3,
        }),
      ],
      validationErrors,
    });

    // Every occurrence after the first collides with the map entry, so each is
    // reported at its own location.
    expect(validationErrors.map((e) => e.location)).toEqual([
      { file: '/repo/src/second.ts', line: 2 },
      { file: '/repo/src/third.ts', line: 3 },
    ]);
  });
});
