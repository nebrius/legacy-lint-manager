import { describe, expect, it } from 'vitest';

import {
  type Comment,
  DEFAULT_PRAGMA,
  type ValidationError,
} from '../../types.js';
import { parseDisableComment } from '../parseDisableComment.js';

const ID = 'a1b2c3d4';

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    rules: [],
    disabledAll: false,
    comment: undefined,
    file: 'test.ts',
    startLine: 1,
    endLine: 1,
    ...overrides,
  };
}

function legacyText(rules: string, id = ID, pragma = DEFAULT_PRAGMA) {
  return `${pragma} (${rules}) ${id}`;
}

describe('parseDisableComment', () => {
  describe('non-legacy comments', () => {
    it('returns undefined and records no error when there is no explanatory text', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ comment: undefined }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toBeUndefined();
      expect(validationErrors).toEqual([]);
    });

    it('returns undefined for a regular explanatory comment that is not a legacy pragma', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ comment: 'because reasons' }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toBeUndefined();
      expect(validationErrors).toEqual([]);
    });

    it('returns undefined for an empty explanatory comment', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({ comment: '' }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toBeUndefined();
      expect(validationErrors).toEqual([]);
    });

    it('ignores a comment that only contains the pragma later in the text', () => {
      const validationErrors: ValidationError[] = [];
      const result = parseDisableComment({
        comment: makeComment({
          comment: `see ${DEFAULT_PRAGMA} (no-console) ${ID}`,
        }),
        pragma: DEFAULT_PRAGMA,
        validationErrors,
      });
      expect(result).toBeUndefined();
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
          file: 'test.ts',
          startLine: 1,
          endLine: 1,
          rules: ['no-console'],
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
        expect(result?.rules).toEqual(['no-console', 'no-debugger']);
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
        expect(result?.rules).toEqual(['no-console', 'no-debugger']);
        expect(validationErrors).toEqual([]);
      });

      it('accepts an id containing mixed-case letters and digits', () => {
        const validationErrors: ValidationError[] = [];
        const result = parseDisableComment({
          comment: makeComment({ comment: legacy('no-console', 'Ab12Cd34') }),
          pragma,
          validationErrors,
        });
        expect(result?.id).toBe('Ab12Cd34');
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
          file: 'src/foo/bar.ts',
          startLine: 42,
          endLine: 42,
          rules: ['no-console'],
          id: ID,
        });
        expect(validationErrors).toEqual([]);
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
            file: 'x.ts',
            line: 7,
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
        expectMalformed(legacy('no-console', 'a1b2-3d4'));
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
          { message: 'pre-existing', file: 'a.ts', line: 1 },
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
          { message: 'pre-existing', file: 'a.ts', line: 1 },
          {
            message: `Malformed legacy comment: ${pragma}`,
            file: 'b.ts',
            line: 2,
          },
          {
            message: `Malformed legacy comment: ${pragma} (x)`,
            file: 'c.ts',
            line: 3,
          },
        ]);
      });
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
      expect(result?.rules).toEqual(['']);
      expect(validationErrors).toEqual([]);
    });
  });
});
