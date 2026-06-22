import { describe, expect, it } from 'vitest';

import type { Comment, ValidationError } from '../../types.js';
import { DEFAULT_PRAGMA } from '../../types.js';
import { getFileComments, parseDisableComment } from '../../util/comments.js';

function parse(fileContents: string, filePath = 'test.ts') {
  return getFileComments({ filePath, fileContents });
}

describe('Comment parsing', () => {
  describe('line comments', () => {
    it('parses a single-rule eslint-disable-line comment', () => {
      expect(parse('// eslint-disable-line no-console')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses multiple comma-separated rules', () => {
      expect(parse('// eslint-disable-line no-console, no-debugger')).toEqual([
        {
          rules: ['no-console', 'no-debugger'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses an explanatory comment after the -- separator', () => {
      expect(
        parse('// eslint-disable-line no-console -- because reasons')
      ).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: 'because reasons',
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('preserves additional -- separators inside the explanation', () => {
      expect(parse('// eslint-disable-line no-console -- a -- b')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: 'a -- b',
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('represents a bare disable directive with no specific rules', () => {
      expect(parse('// eslint-disable')).toEqual([
        {
          rules: [],
          disabledAll: true,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('matches the longest prefix first (eslint-disable-next-line)', () => {
      expect(parse('// eslint-disable-next-line no-console')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses oxlint-disable-next-line', () => {
      expect(parse('// oxlint-disable-next-line no-console')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses oxlint-disable-line', () => {
      expect(parse('// oxlint-disable-line no-debugger')).toEqual([
        {
          rules: ['no-debugger'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses oxlint-disable', () => {
      expect(parse('// oxlint-disable no-console')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses a disable comment trailing actual code', () => {
      expect(parse('const x = 5; // eslint-disable-line no-console')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses a trailing directive after a string literal containing //', () => {
      expect(
        parse("const u = 'http://x'; // eslint-disable-line no-console")
      ).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('trims surrounding whitespace from the prefix and rules', () => {
      expect(
        parse('//    eslint-disable-line    no-console ,  no-debugger  ')
      ).toEqual([
        {
          rules: ['no-console', 'no-debugger'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('ignores a plain, non-directive comment', () => {
      expect(parse('// just a regular comment')).toEqual([]);
    });

    it('ignores a non-disable directive', () => {
      expect(parse('// eslint-enable no-console')).toEqual([]);
    });

    it('ignores a prefix that is not a real directive (no word boundary)', () => {
      expect(parse('// eslint-disablexyz')).toEqual([]);
      expect(parse('// eslint-disable-foo')).toEqual([]);
    });

    it('records the correct file and 1-indexed line for each comment', () => {
      const contents = [
        'const a = 1; // eslint-disable-line no-console',
        'const b = 2;',
        '// eslint-disable-next-line no-debugger',
        'const c = 3;',
      ].join('\n');
      expect(parse(contents, 'src/foo/bar.ts')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'src/foo/bar.ts',
          line: 1,
        },
        {
          rules: ['no-debugger'],
          disabledAll: false,
          comment: undefined,
          file: 'src/foo/bar.ts',
          line: 3,
        },
      ]);
    });
  });

  describe('block comments', () => {
    it('parses a single-line block comment', () => {
      expect(parse('/* eslint-disable no-console */')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses a single-line block comment with an explanation', () => {
      expect(parse('/* eslint-disable no-console -- reason */')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: 'reason',
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses a block comment whose explanation contains a URL', () => {
      expect(
        parse('/* eslint-disable no-console -- see http://example.com */')
      ).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: 'see http://example.com',
          file: 'test.ts',
          line: 1,
        },
      ]);
    });

    it('parses a multi-line block comment into a single comment', () => {
      const contents = [
        '/* eslint-disable no-console,',
        '   no-debugger */',
      ].join('\n');
      const result = parse(contents);
      expect(result).toHaveLength(1);
      expect(result[0].rules).toEqual(['no-console', 'no-debugger']);
      expect(result[0].disabledAll).toBe(false);
    });

    it('records a multi-line block comment at its closing line', () => {
      const contents = [
        '/* eslint-disable no-console,',
        '   no-debugger */',
      ].join('\n');
      expect(parse(contents)[0].line).toBe(2);
    });
  });

  describe('edge and error cases', () => {
    it('returns an empty array for empty input', () => {
      expect(parse('')).toEqual([]);
    });

    it('returns an empty array for whitespace-only input', () => {
      expect(parse('\n\n   \n')).toEqual([]);
    });
  });
});

const ID = 'a1b2c3d4';

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    rules: [],
    disabledAll: false,
    comment: undefined,
    file: 'test.ts',
    line: 1,
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
          line: 1,
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
            line: 42,
          }),
          pragma,
          validationErrors,
        });
        expect(result).toEqual({
          file: 'src/foo/bar.ts',
          line: 42,
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
            line: 7,
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
          comment: makeComment({ comment: pragma, file: 'b.ts', line: 2 }),
          pragma,
          validationErrors,
        });
        parseDisableComment({
          comment: makeComment({
            comment: `${pragma} (x)`,
            file: 'c.ts',
            line: 3,
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
