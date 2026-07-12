import { describe, expect, it } from 'vitest';

import { getFileComments } from '../../util/comments.js';
import type { ValidationError } from '../../util/types.js';

function parse(fileContents: string, filePath = 'test.ts') {
  return getFileComments({ filePath, fileContents, validationErrors: [] })
    .comments;
}

// Returns the validation errors getFileComments accumulates for a source, so
// tests can assert on the parse-error path without inspecting the comments.
function parseErrors(fileContents: string, filePath = 'test.ts') {
  const validationErrors: ValidationError[] = [];
  getFileComments({ filePath, fileContents, validationErrors });
  return validationErrors;
}

// Returns both the parsed comments and the accumulated validation errors from a
// single parse, so the config-rejection path can assert that a comment was
// dropped and an error recorded together.
function parseBoth(fileContents: string, filePath = 'test.ts') {
  const validationErrors: ValidationError[] = [];
  const { comments } = getFileComments({
    filePath,
    fileContents,
    validationErrors,
  });
  return { comments, validationErrors };
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
        },
      ]);
    });

    it('ignores line-form eslint-disable (block-only directive, per ESLint)', () => {
      // ESLint honors plain eslint-disable only as a block comment; as a line
      // comment it is not a directive at all — no disable, and no error.
      expect(parseBoth('// eslint-disable')).toEqual({
        comments: [],
        validationErrors: [],
      });
      expect(parseBoth('// eslint-disable no-console')).toEqual({
        comments: [],
        validationErrors: [],
      });
    });

    it('matches the longest prefix first (eslint-disable-next-line)', () => {
      expect(parse('// eslint-disable-next-line no-console')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          startLine: 0,
          endLine: 0,
          type: 'next-line',
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
          startLine: 0,
          endLine: 0,
          type: 'next-line',
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
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
          startLine: 0,
          endLine: 0,
          type: 'block',
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
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
      // Oxlint prefixes skip the block-only guard the eslint forms hit, so this
      // one reaches the word-boundary check itself: the text after the prefix is
      // neither whitespace nor empty, so it is not treated as a directive.
      expect(parse('// oxlint-disablexyz')).toEqual([]);
    });

    it('records the correct file and 0-indexed line for each comment', () => {
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
          startLine: 0,
          endLine: 0,
          type: 'same-line',
        },
        {
          rules: ['no-debugger'],
          disabledAll: false,
          comment: undefined,
          file: 'src/foo/bar.ts',
          startLine: 2,
          endLine: 2,
          type: 'next-line',
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
          startLine: 0,
          endLine: 0,
          type: 'block',
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
          startLine: 0,
          endLine: 0,
          type: 'block',
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
          startLine: 0,
          endLine: 0,
          type: 'block',
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
      expect(result[0].type).toBe('block');
    });

    it('records a multi-line block comment spanning its start and closing lines', () => {
      const contents = [
        '/* eslint-disable no-console,',
        '   no-debugger */',
      ].join('\n');
      const comment = parse(contents)[0];
      expect(comment.startLine).toBe(0);
      expect(comment.endLine).toBe(1);
      expect(comment.type).toBe('block');
    });

    it('represents a bare disable-all directive with no specific rules', () => {
      expect(parse('/* eslint-disable */')).toEqual([
        {
          rules: [],
          disabledAll: true,
          comment: undefined,
          file: 'test.ts',
          startLine: 0,
          endLine: 0,
          type: 'block',
        },
      ]);
    });

    it('honors a block-form eslint-disable-next-line', () => {
      // ESLint accepts -line / -next-line directives as either line or block
      // comments; only plain eslint-disable is block-only.
      expect(parse('/* eslint-disable-next-line no-console */')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          startLine: 0,
          endLine: 0,
          type: 'next-line',
        },
      ]);
    });

    it('honors a block-form eslint-disable-line', () => {
      expect(parse('/* eslint-disable-line no-console */')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          startLine: 0,
          endLine: 0,
          type: 'same-line',
        },
      ]);
    });

    it('honors a block-form oxlint-disable-next-line (Oxlint has no comment-form restriction)', () => {
      expect(parse('/* oxlint-disable-next-line no-console */')).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          startLine: 0,
          endLine: 0,
          type: 'next-line',
        },
      ]);
    });
  });

  describe('eslint configuration comments', () => {
    // `/* eslint rule: severity */` comments configure rules inline. They are
    // rare, legacy, and ESLint's own parser is partially broken, so we reject
    // them outright and force the author to remove them.
    const REJECT_MESSAGE = 'ESLint configuration comments are not supported';

    it('rejects a single-rule config comment and records its location', () => {
      expect(parseBoth('/* eslint no-console: 0 */')).toEqual({
        comments: [],
        validationErrors: [
          {
            message: REJECT_MESSAGE,
            location: { file: 'test.ts', line: 0 },
          },
        ],
      });
    });

    it('rejects the quoted, plugin-scoped form from the ESLint docs', () => {
      const { comments, validationErrors } = parseBoth(
        '/* eslint "example/rule1": "error" */'
      );
      expect(comments).toEqual([]);
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0].message).toBe(REJECT_MESSAGE);
    });

    it('rejects a multi-rule config comment', () => {
      const { comments, validationErrors } = parseBoth(
        '/* eslint no-console: 0, no-debugger: 0 */'
      );
      expect(comments).toEqual([]);
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0].message).toBe(REJECT_MESSAGE);
    });

    it('detects the directive when a tab separates it from the config', () => {
      // Detection matches `eslint\s`, not a literal space, so a tab-separated
      // config comment is still caught (ESLint treats it as a directive too).
      const { comments, validationErrors } = parseBoth(
        '/* eslint\tno-console: 0 */'
      );
      expect(comments).toEqual([]);
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0].message).toBe(REJECT_MESSAGE);
    });

    it('ignores a line-form eslint config comment (block-only, per ESLint)', () => {
      // ESLint only treats `/* eslint ... */` block comments as config
      // directives; a `// eslint ...` line comment is an ordinary comment, so
      // it is neither parsed nor rejected.
      expect(parseBoth('// eslint no-console: 0')).toEqual({
        comments: [],
        validationErrors: [],
      });
    });

    it('anchors the rejection error to the config comment line', () => {
      const contents = ['const x = 1;', '/* eslint no-console: 0 */'].join(
        '\n'
      );
      const { validationErrors } = parseBoth(contents);
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0].location).toEqual({
        file: 'test.ts',
        line: 1,
      });
    });

    it('does not flag a disable directive as a config comment', () => {
      // `/* eslint-disable ... */` starts with "eslint-", not "eslint ", so it
      // must parse as a disable and never be rejected as a config comment.
      const { comments, validationErrors } = parseBoth(
        '/* eslint-disable no-console */'
      );
      expect(validationErrors).toEqual([]);
      expect(comments).toEqual([
        {
          rules: ['no-console'],
          disabledAll: false,
          comment: undefined,
          file: 'test.ts',
          startLine: 0,
          endLine: 0,
          type: 'block',
        },
      ]);
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

  describe('syntax errors', () => {
    it('records a validation error, anchored to its line, for a file that fails to parse', () => {
      // The bad `;` (nothing where the initializer expression should be) sits on
      // the second line, so the recorded location resolves the parser's byte
      // offset back to a 0-indexed line number.
      const errors = parseErrors('const a = 1;\nconst x = ;');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/^Errors parsing file:/);
      expect(errors[0].location).toEqual({ file: 'test.ts', line: 1 });
    });

    it('anchors an error whose span starts at offset 0 to line 0', () => {
      // A lone `}` is unexpected at the very start of the file, so the parser's
      // label starts at offset 0. Line 0 must still be recorded as a location:
      // the offset is a real position, not a "no span" sentinel.
      const errors = parseErrors('}');
      expect(errors).toHaveLength(1);
      expect(errors[0].location).toEqual({ file: 'test.ts', line: 0 });
    });

    it('records the error without a location when the parser reports no span', () => {
      // Some diagnostics carry no label (here oxc decides the source "appears to
      // be binary"), so there is no offset to resolve; the error is still
      // recorded, just unanchored.
      const errors = parseErrors('\uD800');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/^Errors parsing file:/);
      expect(errors[0].location).toBeUndefined();
    });

    it('leaves the validation errors untouched for a file that parses cleanly', () => {
      expect(parseErrors('// eslint-disable-next-line no-console\nx;')).toEqual(
        []
      );
    });
  });
});
