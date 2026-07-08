import { describe, expect, it } from 'vitest';

import { commaSeparatedStringToArray, escapeRegex } from '../string.js';

describe('commaSeparatedStringToArray', () => {
  it('splits a comma-separated list and trims each entry', () => {
    expect(commaSeparatedStringToArray('no-console, no-debugger')).toEqual([
      'no-console',
      'no-debugger',
    ]);
  });

  it('returns an empty array for an empty string rather than a single empty entry', () => {
    expect(commaSeparatedStringToArray('')).toEqual([]);
  });

  it('returns an empty array for a whitespace-only string', () => {
    expect(commaSeparatedStringToArray('   ')).toEqual([]);
  });

  it('returns a single-element array when there is no comma', () => {
    expect(commaSeparatedStringToArray('no-console')).toEqual(['no-console']);
  });

  it('drops the empty entry left by a trailing comma', () => {
    expect(commaSeparatedStringToArray('no-console,')).toEqual(['no-console']);
  });

  it('drops empty entries between valid rules', () => {
    expect(commaSeparatedStringToArray('no-console, , no-debugger')).toEqual([
      'no-console',
      'no-debugger',
    ]);
  });

  it('trims whitespace surrounding each entry', () => {
    expect(commaSeparatedStringToArray(' no-console ,  no-debugger ')).toEqual([
      'no-console',
      'no-debugger',
    ]);
  });
});

describe('escapeRegex', () => {
  // Every character the RegExp grammar treats as special, except '-' which the
  // helper escapes to '\x2d' rather than with a backslash (covered separately).
  it.each([
    '.',
    '*',
    '+',
    '?',
    '^',
    '$',
    '{',
    '}',
    '(',
    ')',
    '|',
    '[',
    ']',
    '\\',
  ])('backslash-escapes the metacharacter %j', (char) => {
    expect(escapeRegex(char)).toBe(`\\${char}`);
  });

  it('escapes a hyphen to \\x2d rather than with a backslash', () => {
    expect(escapeRegex('a-b')).toBe('a\\x2db');
  });

  it('leaves ordinary characters untouched', () => {
    expect(escapeRegex('no-console')).toBe('no\\x2dconsole');
    expect(escapeRegex('This lint error is legacied')).toBe(
      'This lint error is legacied'
    );
  });

  it('returns an empty string unchanged', () => {
    expect(escapeRegex('')).toBe('');
  });

  it('produces a pattern that matches the original string literally', () => {
    const raw = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o-p';
    expect(new RegExp(`^${escapeRegex(raw)}$`).test(raw)).toBe(true);
  });

  it('does not let metacharacters act as regex operators', () => {
    // If '.' were left unescaped it would match any character, so 'axb' would
    // match the pattern built from 'a.b'.
    expect(new RegExp(`^${escapeRegex('a.b')}$`).test('axb')).toBe(false);
  });

  it('produces a valid pattern for input that is an invalid regex on its own', () => {
    // An unbalanced '[' throws when compiled directly; escaping makes it safe.
    expect(() => new RegExp(escapeRegex('legacy['))).not.toThrow();
  });
});
