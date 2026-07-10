import { describe, expect, it } from 'vitest';

import { DEFAULT_ID_BASE, makeId } from '../../__tests__/helpers/ids.js';
import { createDatabase } from '../../util/db.js';
import type {
  LegacyComment,
  NonLegacyComment,
  ValidationError,
} from '../../util/types.js';
import { validateDisableComments } from '../validateDisableComments.js';

// An arbitrary valid id, shared between each test's database entry and the
// legacy comment that references it; the exact value is irrelevant.
const ID = makeId(DEFAULT_ID_BASE);

function makeLegacy(overrides: Partial<LegacyComment> = {}): LegacyComment {
  return {
    type: 'legacy',
    file: 'test.ts',
    startLine: 1,
    endLine: 1,
    legaciedRules: ['no-console'],
    nonLegaciedRules: [],
    id: ID,
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
    linterType: 'eslint',
    ...overrides,
  });
}

describe('validateDisableComments', () => {
  describe('tracking which database ids were found in code', () => {
    it('returns an empty map and no fixes when the database is empty and there are no comments', () => {
      const result = callValidate();
      expect(result).toEqual({ ids: new Map(), wereErrorsFixed: false });
    });

    it('reports errors as fixed when a database id has no matching comment', () => {
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [
            ['id1', ['no-console']],
            ['id2', ['no-console']],
            ['id3', ['no-console']],
          ],
        }),
      });
      // No comment matches any id, so every id counts as a fixed (removed) error.
      expect(result).toEqual({ ids: new Map(), wereErrorsFixed: true });
    });

    it('keeps an id when a matching comment is found', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [
            ['id1', ['no-console']],
            ['id2', ['no-console']],
          ],
        }),
        validationErrors,
        legacyComments: [makeLegacy({ id: 'id1' })],
      });
      // id1 was found in code (kept), id2 was not (a fixed error).
      expect(result).toEqual({
        ids: new Map([['id1', ['no-console']]]),
        wereErrorsFixed: true,
      });
      expect(validationErrors).toEqual([]);
    });

    it('carries each kept id’s rules through from the database', () => {
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [
            ['a', ['no-console', 'no-debugger']],
            ['b', ['no-var']],
          ],
        }),
        legacyComments: [
          makeLegacy({ id: 'a', legaciedRules: ['no-console', 'no-debugger'] }),
          makeLegacy({ id: 'b', legaciedRules: ['no-var'] }),
        ],
      });
      expect(result).toEqual({
        ids: new Map([
          ['a', ['no-console', 'no-debugger']],
          ['b', ['no-var']],
        ]),
        wereErrorsFixed: false,
      });
    });
  });

  describe('unregistered legacy errors', () => {
    it('records an error when a comment id is not in the database', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [['id1', ['no-console']]],
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
          location: { file: 'src/a.ts', line: 12 },
        },
      ]);
      // An unregistered id never enters the database map, so it is not kept, and
      // the registered id1 (never found) counts as a fixed error.
      expect(result).toEqual({ ids: new Map(), wereErrorsFixed: true });
    });
  });

  describe('duplicate legacy ids', () => {
    it('records an error for the second use of the same id', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [
            ['dup', ['no-console']],
            ['other', ['no-console']],
          ],
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
          location: { file: 'b.ts', line: 2 },
        },
      ]);
      // A duplicated id is still kept exactly once; "other" was never found.
      expect(result).toEqual({
        ids: new Map([['dup', ['no-console']]]),
        wereErrorsFixed: true,
      });
    });

    it('records an error for every use beyond the first', () => {
      const validationErrors: ValidationError[] = [];
      callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [['dup', ['no-console']]],
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
          location: { file: 'b.ts', line: 2 },
        },
        {
          message:
            'Duplicate legacy ID "dup". Each legacy ID can only be used once.',
          location: { file: 'c.ts', line: 3 },
        },
      ]);
    });
  });

  describe('rules must be defined in the database', () => {
    it('records an error when a comment legacies a rule the database does not list for that id', () => {
      // The comment claims to legacy a rule that was never recorded against this
      // id, which would smuggle a new violation in under an existing legacy.
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [['id1', ['no-console']]],
        }),
        validationErrors,
        legacyComments: [
          makeLegacy({
            id: 'id1',
            legaciedRules: ['no-console', 'no-debugger'],
            file: 'src/a.ts',
            startLine: 4,
            endLine: 4,
          }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Rule "no-debugger" for legacy ID "id1" is not defined in the database.',
          location: { file: 'src/a.ts', line: 4 },
        },
      ]);
      // The id is still found in code, so it is kept with its database rules.
      expect(result).toEqual({
        ids: new Map([['id1', ['no-console']]]),
        wereErrorsFixed: false,
      });
    });

    it('records one error per undefined rule', () => {
      const validationErrors: ValidationError[] = [];
      callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [['id1', ['no-console']]],
        }),
        validationErrors,
        legacyComments: [
          makeLegacy({
            id: 'id1',
            legaciedRules: ['no-console', 'no-debugger', 'no-var'],
            file: 'src/a.ts',
            startLine: 4,
            endLine: 4,
          }),
        ],
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Rule "no-debugger" for legacy ID "id1" is not defined in the database.',
          location: { file: 'src/a.ts', line: 4 },
        },
        {
          message:
            'Rule "no-var" for legacy ID "id1" is not defined in the database.',
          location: { file: 'src/a.ts', line: 4 },
        },
      ]);
    });

    it('does not flag rules that are a subset of the database rules', () => {
      // Legacying fewer rules than the database lists is fine (the extra rules
      // were fixed), so no error is recorded.
      const validationErrors: ValidationError[] = [];
      callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [['id1', ['no-console', 'no-debugger']]],
        }),
        validationErrors,
        legacyComments: [
          makeLegacy({ id: 'id1', legaciedRules: ['no-console'] }),
        ],
      });
      expect(validationErrors).toEqual([]);
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
          location: { file: 'src/a.ts', line: 5 },
        },
      ]);
      // Non-legacy comments never participate in id tracking.
      expect(result).toEqual({ ids: new Map(), wereErrorsFixed: false });
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
          location: { file: 'a.ts', line: 3 },
        },
        {
          message: 'Rule "no-debugger" cannot be disabled.',
          location: { file: 'a.ts', line: 3 },
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
          location: { file: 'a.ts', line: 1 },
        },
        {
          message: 'Rule "no-console" cannot be disabled.',
          location: { file: 'c.ts', line: 3 },
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
          databaseContents: [[ID, ['no-console']]],
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
          location: { file: 'src/a.ts', line: 8 },
        },
      ]);
    });

    it('leaves a legacy comment’s non-legacied rule alone when it is not non-disableable', () => {
      // A rule the comment disables outright (not legacied) is only an error
      // when it is on the non-disableable list; otherwise it is a normal disable.
      const validationErrors: ValidationError[] = [];
      callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [[ID, ['no-console']]],
        }),
        nonDisableableRules: ['no-debugger'],
        validationErrors,
        legacyComments: [
          makeLegacy({
            legaciedRules: ['no-console'],
            nonLegaciedRules: ['no-alert'],
          }),
        ],
      });
      expect(validationErrors).toEqual([]);
    });

    it('exempts a non-disableable rule that is legacied (old violations are allowed)', () => {
      // The whole point of the legacy system: a grandfathered violation of a
      // non-disableable rule is permitted, only new ones are rejected.
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [[ID, ['no-console']]],
        }),
        nonDisableableRules: ['no-console'],
        validationErrors,
        legacyComments: [
          makeLegacy({ legaciedRules: ['no-console'], nonLegaciedRules: [] }),
        ],
      });
      expect(validationErrors).toEqual([]);
      expect(result).toEqual({
        ids: new Map([[ID, ['no-console']]]),
        wereErrorsFixed: false,
      });
    });
  });

  describe('non-disableable rule matching is linter-aware', () => {
    // ESLint requires the exact, fully-qualified rule ID in a disable directive:
    // there is no aliasing, so `no-explicit-any` and `@typescript-eslint/no-explicit-any`
    // are distinct. Matching stays exact for ESLint.
    describe('ESLint (exact match, no prefix stripping)', () => {
      it('does not match a bare comment against a prefixed non-disableable rule', () => {
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'eslint',
          nonDisableableRules: ['@typescript-eslint/no-explicit-any'],
          validationErrors,
          nonLegacyComments: [makeNonLegacy({ rules: ['no-explicit-any'] })],
        });
        expect(validationErrors).toEqual([]);
      });

      it('matches when the comment uses the exact fully-qualified rule ID', () => {
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'eslint',
          nonDisableableRules: ['@typescript-eslint/no-explicit-any'],
          validationErrors,
          nonLegacyComments: [
            makeNonLegacy({
              rules: ['@typescript-eslint/no-explicit-any'],
              file: 'a.ts',
              startLine: 2,
              endLine: 2,
            }),
          ],
        });
        expect(validationErrors).toEqual([
          {
            message:
              'Rule "@typescript-eslint/no-explicit-any" cannot be disabled.',
            location: { file: 'a.ts', line: 2 },
          },
        ]);
      });
    });

    // Oxlint strips the plugin prefix from both the directive and the rule name
    // and compares the bare rule name, so the prefix is decorative. We mirror that
    // when checking whether a rule is non-disableable.
    // See https://github.com/oxc-project/oxc/blob/main/crates/oxc_linter/src/disable_directives.rs
    describe('Oxlint (prefix-insensitive base-name match)', () => {
      it('flags a bare comment against a prefixed non-disableable rule (the closed bypass)', () => {
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'oxlint',
          nonDisableableRules: ['eslint/no-console'],
          validationErrors,
          nonLegacyComments: [
            makeNonLegacy({
              rules: ['no-console'],
              file: 'a.ts',
              startLine: 3,
              endLine: 3,
            }),
          ],
        });
        expect(validationErrors).toEqual([
          {
            message: 'Rule "no-console" cannot be disabled.',
            location: { file: 'a.ts', line: 3 },
          },
        ]);
      });

      it('flags a prefixed comment against the same prefixed non-disableable rule', () => {
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'oxlint',
          nonDisableableRules: ['eslint/no-console'],
          validationErrors,
          nonLegacyComments: [
            makeNonLegacy({
              rules: ['eslint/no-console'],
              file: 'a.ts',
              startLine: 4,
              endLine: 4,
            }),
          ],
        });
        expect(validationErrors).toEqual([
          {
            message: 'Rule "eslint/no-console" cannot be disabled.',
            location: { file: 'a.ts', line: 4 },
          },
        ]);
      });

      it('ignores the plugin prefix, so a different plugin sharing the rule name still matches', () => {
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'oxlint',
          nonDisableableRules: ['jest/no-focused-tests'],
          validationErrors,
          nonLegacyComments: [
            makeNonLegacy({
              rules: ['vitest/no-focused-tests'],
              file: 'a.ts',
              startLine: 5,
              endLine: 5,
            }),
          ],
        });
        expect(validationErrors).toEqual([
          {
            message: 'Rule "vitest/no-focused-tests" cannot be disabled.',
            location: { file: 'a.ts', line: 5 },
          },
        ]);
      });

      it('matches a prefixed comment against a bare non-disableable rule', () => {
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'oxlint',
          nonDisableableRules: ['no-console'],
          validationErrors,
          nonLegacyComments: [
            makeNonLegacy({
              rules: ['eslint/no-console'],
              file: 'a.ts',
              startLine: 6,
              endLine: 6,
            }),
          ],
        });
        expect(validationErrors).toEqual([
          {
            message: 'Rule "eslint/no-console" cannot be disabled.',
            location: { file: 'a.ts', line: 6 },
          },
        ]);
      });

      it('compares the base name exactly, not as a substring', () => {
        // `no-re-export` ends with `export` but is a different rule, so it must
        // not match the non-disableable `export` rule.
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'oxlint',
          nonDisableableRules: ['import/export'],
          validationErrors,
          nonLegacyComments: [
            makeNonLegacy({ rules: ['canonical/no-re-export'] }),
          ],
        });
        expect(validationErrors).toEqual([]);
      });

      it('does not match a rule with a different base name', () => {
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'oxlint',
          nonDisableableRules: ['eslint/no-console'],
          validationErrors,
          nonLegacyComments: [makeNonLegacy({ rules: ['no-debugger'] })],
        });
        expect(validationErrors).toEqual([]);
      });

      it('applies the same base-name matching to a legacy comment’s non-legacied rules', () => {
        const validationErrors: ValidationError[] = [];
        callValidate({
          linterType: 'oxlint',
          database: createDatabase({
            filePath: undefined,
            databaseContents: [[ID, ['no-console']]],
          }),
          nonDisableableRules: ['typescript/no-explicit-any'],
          validationErrors,
          legacyComments: [
            makeLegacy({
              legaciedRules: ['no-console'],
              nonLegaciedRules: ['no-explicit-any'],
              file: 'src/a.ts',
              startLine: 8,
              endLine: 8,
            }),
          ],
        });
        expect(validationErrors).toEqual([
          {
            message: 'Rule "no-explicit-any" cannot be disabled.',
            location: { file: 'src/a.ts', line: 8 },
          },
        ]);
      });
    });
  });

  describe('combined scenarios', () => {
    it('handles kept, fixed, unregistered, and duplicate ids together', () => {
      const validationErrors: ValidationError[] = [];
      const result = callValidate({
        database: createDatabase({
          filePath: undefined,
          databaseContents: [
            ['dup', ['no-console']],
            ['unused', ['no-console']],
            ['used', ['no-console']],
          ],
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
        ids: new Map([
          ['dup', ['no-console']],
          ['used', ['no-console']],
        ]),
        wereErrorsFixed: true,
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Duplicate legacy ID "dup". Each legacy ID can only be used once.',
          location: { file: 'c.ts', line: 3 },
        },
        {
          message: 'Unregistered legacy error. New errors cannot be legacied.',
          location: { file: 'd.ts', line: 4 },
        },
      ]);
    });
  });
});
