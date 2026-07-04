import { describe, expect, it } from 'vitest';

import { DEFAULT_PRAGMA } from '../constants.js';
import { parseDisableComment } from '../parseDisableComment.js';
import type { Comment, ValidationError } from '../types.js';

const ID = 'a1b2c3d4';

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
  ])('with $label', ({ pragma }) => {
    function legacy(rules: string, id = ID) {
      return legacyText(rules, id, pragma);
    }

    describe('valid legacy comments', () => {
      it('parses a single-rule legacy comment', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({ comment: legacy('no-console') }),
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
          comment: makeComment({ comment: legacy('no-console,no-debugger') }),
          pragma,
          validationErrors,
        });
        expect(result?.type === 'legacy' && result.legaciedRules).toEqual([
          'no-console',
          'no-debugger',
        ]);
        expect(validationErrors).toEqual([]);
      });

      it('trims surrounding whitespace from each rule', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({
            comment: legacy(' no-console ,  no-debugger '),
          }),
          pragma,
          validationErrors,
        });
        expect(result?.type === 'legacy' && result.legaciedRules).toEqual([
          'no-console',
          'no-debugger',
        ]);
        expect(validationErrors).toEqual([]);
      });

      it('accepts an id containing mixed-case letters, digits, and underscores/dashes', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({ comment: legacy('no-console', 'Ab2_Cd-4') }),
          pragma,
          validationErrors,
        });
        expect(result?.type === 'legacy' && result.id).toBe('Ab2_Cd-4');
        expect(validationErrors).toEqual([]);
      });

      it('passes through the comment file and line', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({
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

      it('appends the error after any pre-existing errors', () => {
        const validationErrors: ValidationError[] = [
          { message: 'pre-existing', location: { file: 'a.ts', line: 1 } },
        ];
        parseDisableComment({
          comment: makeComment({
            type: 'same-line',
            comment: legacy('no-console'),
            file: 'b.ts',
            startLine: 2,
            endLine: 2,
          }),
          pragma,
          validationErrors,
        });
        expect(validationErrors).toEqual([
          { message: 'pre-existing', location: { file: 'a.ts', line: 1 } },
          {
            message: NEXT_LINE_MESSAGE,
            location: { file: 'b.ts', line: 2 },
          },
        ]);
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

      it('flags an id shorter than 8 characters', () => {
        expectMalformed(legacy('no-console', 'a1b2c3d'));
      });

      it('flags an id longer than 8 characters', () => {
        expectMalformed(legacy('no-console', 'a1b2c3d4e'));
      });

      it('flags an id containing non-alphanumeric characters', () => {
        expectMalformed(legacy('no-console', 'a1b2%3d4'));
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
      expect(result?.type === 'legacy' && result.nonLegaciedRules).toEqual([]);
      expect(validationErrors).toEqual([]);
    });

    it('only filters the directive rules, so a pragma rule absent from the directive is still legacied', () => {
      // nonLegaciedRules is derived from the directive's rules, not the pragma's,
      // so a rule named in the pragma but not disabled by the directive simply
      // appears in legaciedRules and never in nonLegaciedRules.
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
        legaciedRules: ['no-console', 'no-debugger'],
        nonLegaciedRules: [],
        id: ID,
      });
      expect(validationErrors).toEqual([]);
    });
  });

  describe('documented edge-case behavior', () => {
    it('produces a single empty-string rule for an empty rule list', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ comment: legacyText('') }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result?.type === 'legacy' && result.legaciedRules).toEqual(['']);
      expect(validationErrors).toEqual([]);
    });
  });
});
