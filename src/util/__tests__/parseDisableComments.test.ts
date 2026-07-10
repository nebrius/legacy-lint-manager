import { describe, expect, it } from 'vitest';

import { asLegacy } from '../../__tests__/helpers/comments.js';
import { DEFAULT_ID_BASE, makeId } from '../../__tests__/helpers/ids.js';
import { DEFAULT_PRAGMA, ID_LENGTH } from '../constants.js';
import { parseDisableComment } from '../parseDisableComment.js';
import type { Comment, ValidationError } from '../types.js';

const ID = makeId(DEFAULT_ID_BASE);

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    rules: [],
    disabledAll: false,
    comment: undefined,
    file: 'test.ts',
    startLine: 1,
    endLine: 1,
    type: 'next-line',
    ...overrides,
  };
}

function legacyText(rules: string, id = ID, pragma = DEFAULT_PRAGMA) {
  return `${pragma} (${rules}) ${id}`;
}

describe('parseDisableComment', () => {
  describe('non-legacy comments', () => {
    it('returns a non-legacy comment and records no error when there is no explanatory text', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ comment: undefined }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toEqual({
        type: 'nonlegacy',
        file: 'test.ts',
        startLine: 1,
        endLine: 1,
        rules: [],
      });
      expect(validationErrors).toEqual([]);
    });

    it('returns a non-legacy comment for a regular explanatory comment that is not a legacy pragma', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ comment: 'because reasons' }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toEqual({
        type: 'nonlegacy',
        file: 'test.ts',
        startLine: 1,
        endLine: 1,
        rules: [],
      });
      expect(validationErrors).toEqual([]);
    });

    it('returns a non-legacy comment for an empty explanatory comment', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ comment: '' }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toEqual({
        type: 'nonlegacy',
        file: 'test.ts',
        startLine: 1,
        endLine: 1,
        rules: [],
      });
      expect(validationErrors).toEqual([]);
    });

    it('treats a comment that only contains the pragma later in the text as non-legacy', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({
          comment: `see ${DEFAULT_PRAGMA} (no-console) ${ID}`,
        }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result?.type).toBe('nonlegacy');
      expect(validationErrors).toEqual([]);
    });

    it('returns a non-legacy comment for a block disable without the pragma', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ type: 'block', comment: 'because reasons' }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toEqual({
        type: 'nonlegacy',
        file: 'test.ts',
        startLine: 1,
        endLine: 1,
        rules: [],
      });
      expect(validationErrors).toEqual([]);
    });

    it('returns a non-legacy comment for a same-line disable without the pragma', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ type: 'same-line', comment: undefined }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toEqual({
        type: 'nonlegacy',
        file: 'test.ts',
        startLine: 1,
        endLine: 1,
        rules: [],
      });
      expect(validationErrors).toEqual([]);
    });

    it('carries the disabled rules through to the non-legacy comment', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({
          rules: ['no-console', 'no-debugger'],
          comment: undefined,
        }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toEqual({
        type: 'nonlegacy',
        file: 'test.ts',
        startLine: 1,
        endLine: 1,
        rules: ['no-console', 'no-debugger'],
      });
      expect(validationErrors).toEqual([]);
    });
  });

  // Run the parsing and error-reporting suites against both the built-in
  // pragma and a non-default pragma to ensure the pragma is honored verbatim.
  describe.each([
    { label: 'the default pragma', pragma: DEFAULT_PRAGMA },
    { label: 'a non-default pragma', pragma: 'CUSTOM LEGACY PRAGMA' },
    // The pragma is interpolated into a RegExp, so each of these
    // metacharacters must be matched literally rather than as regex syntax.
    {
      label: 'a pragma with regex special characters',
      pragma: 'LEGACY.v1 (do-not-copy)* [KEEP]?',
    },
  ])('with $label', ({ pragma }) => {
    function legacy(rules: string, id = ID) {
      return legacyText(rules, id, pragma);
    }

    describe('valid legacy comments', () => {
      it('parses a single-rule legacy comment', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({
            rules: ['no-console'],
            comment: legacy('no-console'),
          }),
          pragma,
          validationErrors,
        });
        expect(result).toEqual({
          type: 'legacy',
          file: 'test.ts',
          startLine: 1,
          endLine: 1,
          legaciedRules: ['no-console'],
          nonLegaciedRules: [],
          id: ID,
        });
        expect(validationErrors).toEqual([]);
      });

      it('parses multiple comma-separated rules', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({
            rules: ['no-console', 'no-debugger'],
            comment: legacy('no-console,no-debugger'),
          }),
          pragma,
          validationErrors,
        });
        expect(asLegacy(result).legaciedRules).toEqual([
          'no-console',
          'no-debugger',
        ]);
        expect(validationErrors).toEqual([]);
      });

      it('trims surrounding whitespace from each rule', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({
            rules: ['no-console', 'no-debugger'],
            comment: legacy(' no-console ,  no-debugger '),
          }),
          pragma,
          validationErrors,
        });
        expect(asLegacy(result).legaciedRules).toEqual([
          'no-console',
          'no-debugger',
        ]);
        expect(validationErrors).toEqual([]);
      });

      it('accepts an id containing mixed-case letters, digits, and underscores/dashes', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({
            rules: ['no-console'],
            comment: legacy('no-console', makeId('Ab2_Cd-4')),
          }),
          pragma,
          validationErrors,
        });
        expect(asLegacy(result).id).toBe(makeId('Ab2_Cd-4'));
        expect(validationErrors).toEqual([]);
      });

      it('passes through the comment file and line', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({
            rules: ['no-console'],
            comment: legacy('no-console'),
            file: 'src/foo/bar.ts',
            startLine: 42,
            endLine: 42,
          }),
          pragma,
          validationErrors,
        });
        expect(result).toEqual({
          type: 'legacy',
          file: 'src/foo/bar.ts',
          startLine: 42,
          endLine: 42,
          legaciedRules: ['no-console'],
          nonLegaciedRules: [],
          id: ID,
        });
        expect(validationErrors).toEqual([]);
      });
    });

    describe('non-next-line legacy comments', () => {
      // Legacy comments are only valid on `*-disable-next-line` directives.
      // Allowing the pragma on a block `*-disable` (or `*-disable-line`) would
      // let a user widen a legacied disable to cover new violations, so the
      // pragma on any other directive type is rejected outright.
      const NEXT_LINE_MESSAGE = 'Legacy comment must use *-disable-next-line';

      function expectRejected(comment: Comment) {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment,
          pragma,
          validationErrors,
        });
        expect(result).toBeUndefined();
        expect(validationErrors).toEqual([
          {
            message: NEXT_LINE_MESSAGE,
            location: {
              file: comment.file,
              line: comment.startLine,
            },
          },
        ]);
      }

      it('rejects a well-formed legacy pragma on a block disable', () => {
        expectRejected(
          makeComment({ type: 'block', comment: legacy('no-console') })
        );
      });

      it('rejects a well-formed legacy pragma on a same-line disable', () => {
        expectRejected(
          makeComment({ type: 'same-line', comment: legacy('no-console') })
        );
      });

      it('rejects a malformed pragma on a block disable with the next-line error, not the malformed error', () => {
        // The directive-type guard runs before the strict format check, so a
        // pragma on the wrong directive type is reported as such even when its
        // text would also fail the format check.
        expectRejected(makeComment({ type: 'block', comment: pragma }));
      });

      it('reports the error on the start line of a multi-line block disable', () => {
        expectRejected(
          makeComment({
            type: 'block',
            comment: legacy('no-console'),
            file: 'multi.ts',
            startLine: 10,
            endLine: 14,
          })
        );
      });
    });

    describe('malformed legacy comments', () => {
      function expectMalformed(commentText: string) {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({
            comment: commentText,
            file: 'x.ts',
            startLine: 7,
            endLine: 7,
          }),
          pragma,
          validationErrors,
        });
        expect(result).toBeUndefined();
        expect(validationErrors).toEqual([
          {
            message: `Malformed legacy comment: ${commentText}`,
            location: {
              file: 'x.ts',
              line: 7,
            },
          },
        ]);
      }

      it('flags a bare pragma with no rules or id', () => {
        expectMalformed(pragma);
      });

      it('flags a pragma with rules but no id', () => {
        expectMalformed(`${pragma} (no-console)`);
      });

      it('flags an id shorter than the required length', () => {
        expectMalformed(
          legacy('no-console', makeId('a1b2c3d4').slice(0, ID_LENGTH - 1))
        );
      });

      it('flags an id longer than the required length', () => {
        expectMalformed(legacy('no-console', `${makeId('a1b2c3d4')}x`));
      });

      it('flags an id containing non-alphanumeric characters', () => {
        expectMalformed(legacy('no-console', makeId('a1b2%3d4')));
      });

      it('flags a comment missing the parentheses around the rules', () => {
        expectMalformed(`${pragma} no-console ${ID}`);
      });

      it('flags extra whitespace between the pragma and the rules', () => {
        expectMalformed(`${pragma}  (no-console) ${ID}`);
      });

      it('flags extra whitespace between the rules and the id', () => {
        expectMalformed(`${pragma} (no-console)  ${ID}`);
      });

      it('flags trailing content after the id', () => {
        expectMalformed(`${legacy('no-console')} extra`);
      });

      it('appends an error per malformed comment without clobbering existing errors', () => {
        const validationErrors: ValidationError[] = [
          { message: 'pre-existing', location: { file: 'a.ts', line: 1 } },
        ];
        parseDisableComment({
          comment: makeComment({
            comment: pragma,
            file: 'b.ts',
            startLine: 2,
            endLine: 2,
          }),
          pragma,
          validationErrors,
        });
        parseDisableComment({
          comment: makeComment({
            comment: `${pragma} (x)`,
            file: 'c.ts',
            startLine: 3,
            endLine: 3,
          }),
          pragma,
          validationErrors,
        });
        expect(validationErrors).toEqual([
          { message: 'pre-existing', location: { file: 'a.ts', line: 1 } },
          {
            message: `Malformed legacy comment: ${pragma}`,
            location: { file: 'b.ts', line: 2 },
          },
          {
            message: `Malformed legacy comment: ${pragma} (x)`,
            location: { file: 'c.ts', line: 3 },
          },
        ]);
      });
    });

    describe('rules named in the comment but absent from the directive', () => {
      // The pragma may only legacy rules the directive actually disables. A rule
      // named in the pragma but missing from the directive's disable list is
      // stripped from legaciedRules and reported. Empty entries (from `()`, a
      // trailing/double comma, or whitespace) are dropped silently instead. If
      // nothing survives, the whole comment is rejected.
      const NOT_IN_LIST = (rule: string) =>
        `Rule ${rule} in legacy comment is not in the actual lint disable list and should be removed.`;
      const NO_VALID_RULES =
        'Legacy comment has no valid rules and should be removed';

      describe('partial drop (some rules survive)', () => {
        it('strips a foreign rule and reports it while keeping the valid rule legacied', () => {
          const validationErrors: ValidationError[] = [];
          const result = parseDisableComment({
            comment: makeComment({
              rules: ['foo'],
              comment: legacy('foo, bar'),
              file: 'src/app.ts',
              startLine: 12,
              endLine: 12,
            }),
            pragma,
            validationErrors,
          });
          expect(result).toEqual({
            type: 'legacy',
            file: 'src/app.ts',
            startLine: 12,
            endLine: 12,
            legaciedRules: ['foo'],
            nonLegaciedRules: [],
            id: ID,
          });
          expect(validationErrors).toEqual([
            {
              message: NOT_IN_LIST('bar'),
              location: { file: 'src/app.ts', line: 12 },
            },
          ]);
        });

        it('reports one error per foreign rule, in the order they are listed', () => {
          const validationErrors: ValidationError[] = [];
          const result = parseDisableComment({
            comment: makeComment({
              rules: ['keep'],
              comment: legacy('keep, extra-one, extra-two'),
            }),
            pragma,
            validationErrors,
          });
          expect(asLegacy(result).legaciedRules).toEqual(['keep']);
          expect(validationErrors).toEqual([
            {
              message: NOT_IN_LIST('extra-one'),
              location: { file: 'test.ts', line: 1 },
            },
            {
              message: NOT_IN_LIST('extra-two'),
              location: { file: 'test.ts', line: 1 },
            },
          ]);
        });
      });

      describe('empty entries are skipped silently', () => {
        it('ignores a trailing comma without recording an error', () => {
          const validationErrors: ValidationError[] = [];
          const result = parseDisableComment({
            comment: makeComment({
              rules: ['no-console'],
              comment: legacy('no-console,'),
            }),
            pragma,
            validationErrors,
          });
          expect(asLegacy(result).legaciedRules).toEqual(['no-console']);
          expect(validationErrors).toEqual([]);
        });

        it('ignores an empty entry between two valid rules', () => {
          const validationErrors: ValidationError[] = [];
          const result = parseDisableComment({
            comment: makeComment({
              rules: ['no-console', 'no-debugger'],
              comment: legacy('no-console, , no-debugger'),
            }),
            pragma,
            validationErrors,
          });
          expect(asLegacy(result).legaciedRules).toEqual([
            'no-console',
            'no-debugger',
          ]);
          expect(validationErrors).toEqual([]);
        });
      });

      describe('no valid rules (comment rejected)', () => {
        it('rejects the comment when every listed rule is foreign, reporting each rule then the summary', () => {
          const validationErrors: ValidationError[] = [];
          const result = parseDisableComment({
            comment: makeComment({
              rules: [],
              comment: legacy('bar, baz'),
              file: 'x.ts',
              startLine: 7,
              endLine: 7,
            }),
            pragma,
            validationErrors,
          });
          expect(result).toBeUndefined();
          expect(validationErrors).toEqual([
            {
              message: NOT_IN_LIST('bar'),
              location: { file: 'x.ts', line: 7 },
            },
            {
              message: NOT_IN_LIST('baz'),
              location: { file: 'x.ts', line: 7 },
            },
            { message: NO_VALID_RULES, location: { file: 'x.ts', line: 7 } },
          ]);
        });

        it('rejects a single foreign rule with a per-rule error followed by the summary error', () => {
          const validationErrors: ValidationError[] = [];
          const result = parseDisableComment({
            comment: makeComment({ rules: [], comment: legacy('bar') }),
            pragma,
            validationErrors,
          });
          expect(result).toBeUndefined();
          expect(validationErrors).toEqual([
            {
              message: NOT_IN_LIST('bar'),
              location: { file: 'test.ts', line: 1 },
            },
            { message: NO_VALID_RULES, location: { file: 'test.ts', line: 1 } },
          ]);
        });
      });
    });
  });

  describe('regex-special characters in the pragma are escaped', () => {
    // The pragma is matched via a RegExp, so these guard that the pragma is
    // treated as literal text rather than a pattern.
    it('matches a metacharacter in the pragma literally, not as a wildcard', () => {
      const pragma = 'a.b';
      const validationErrors: ValidationError[] = [];

      // The '.' must match a literal dot: a comment starting with 'axb' is not
      // this pragma and is treated as a regular, non-legacy comment.
      const nonLegacy = parseDisableComment({
        comment: makeComment({
          rules: ['no-console'],
          comment: `axb (no-console) ${ID}`,
        }),
        pragma,
        validationErrors,
      });
      expect(nonLegacy?.type).toBe('nonlegacy');

      // The literal pragma still parses as a legacy comment.
      const legacy = parseDisableComment({
        comment: makeComment({
          rules: ['no-console'],
          comment: `a.b (no-console) ${ID}`,
        }),
        pragma,
        validationErrors,
      });
      expect(legacy?.type).toBe('legacy');
      expect(validationErrors).toEqual([]);
    });

    it('does not throw when the pragma is not a valid regex on its own', () => {
      // An unbalanced '[' would make the interpolated RegExp throw if the pragma
      // were not escaped first.
      const pragma = 'legacy[pragma';
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({
          rules: ['no-console'],
          comment: `${pragma} (no-console) ${ID}`,
        }),
        pragma,
        validationErrors,
      });
      expect(result?.type).toBe('legacy');
      expect(validationErrors).toEqual([]);
    });
  });

  describe('splitting legacied from non-legacied rules', () => {
    // A single disable directive can disable several rules while the legacy
    // pragma only legacies a subset. The rules that the directive disables but
    // the pragma does not name are "non-legacied" and treated as fresh disables.
    it('puts directive rules absent from the pragma into nonLegaciedRules', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({
          rules: ['no-console', 'no-debugger'],
          comment: legacyText('no-console'),
        }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toEqual({
        type: 'legacy',
        file: 'test.ts',
        startLine: 1,
        endLine: 1,
        legaciedRules: ['no-console'],
        nonLegaciedRules: ['no-debugger'],
        id: ID,
      });
      expect(validationErrors).toEqual([]);
    });

    it('leaves nonLegaciedRules empty when the pragma legacies every disabled rule', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({
          rules: ['no-console', 'no-debugger'],
          comment: legacyText('no-console,no-debugger'),
        }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(asLegacy(result).nonLegaciedRules).toEqual([]);
      expect(validationErrors).toEqual([]);
    });

    it('drops a pragma rule absent from the directive and reports it, keeping the surviving rule legacied', () => {
      // A rule named in the pragma but not disabled by the directive is bogus:
      // it is stripped from legaciedRules and flagged. The remaining rule that
      // the directive does disable is still legacied, and because every directive
      // rule is named in the pragma, nonLegaciedRules stays empty.
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({
          rules: ['no-console'],
          comment: legacyText('no-console,no-debugger'),
        }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toEqual({
        type: 'legacy',
        file: 'test.ts',
        startLine: 1,
        endLine: 1,
        legaciedRules: ['no-console'],
        nonLegaciedRules: [],
        id: ID,
      });
      expect(validationErrors).toEqual([
        {
          message:
            'Rule no-debugger in legacy comment is not in the actual lint disable list and should be removed.',
          location: { file: 'test.ts', line: 1 },
        },
      ]);
    });
  });

  describe('documented edge-case behavior', () => {
    it('rejects an empty rule list, skipping the empty entry silently before failing on no valid rules', () => {
      // `()` yields a single empty-string entry after splitting. The empty-entry
      // guard drops it without a per-rule error, leaving nothing legacied, so the
      // comment is rejected with only the "no valid rules" error.
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ comment: legacyText('') }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toBeUndefined();
      expect(validationErrors).toEqual([
        {
          message: 'Legacy comment has no valid rules and should be removed',
          location: { file: 'test.ts', line: 1 },
        },
      ]);
    });
  });
});
