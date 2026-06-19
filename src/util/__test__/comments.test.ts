import { describe, expect, it } from 'vitest';

import { getFileComments } from '../comments.js';

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

    it('records a multi-line block comment at its opening line', () => {
      const contents = [
        '/* eslint-disable no-console,',
        '   no-debugger */',
      ].join('\n');
      expect(parse(contents)[0].line).toBe(1);
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
