import { describe, expect, it } from 'vitest';

import { commaSeparatedStringToArray } from '../string.js';

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
