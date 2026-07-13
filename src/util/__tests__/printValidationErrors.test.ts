import { afterEach, describe, expect, it, vi } from 'vitest';

import { printValidationErrors } from '../printValidationErrors.js';
import type { ValidationError } from '../types.js';

const ROOT = '/repo';

// Both branches of printValidationErrors funnel through logging.error ->
// console.error, so capturing console.error captures the full output in order.
function captureErrors() {
  const messages: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((msg: string) => {
    messages.push(msg);
  });
  return messages;
}

describe('printValidationErrors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints nothing when there are no validation errors', () => {
    const messages = captureErrors();
    printValidationErrors({ validationErrors: [], repoRootDir: ROOT });
    expect(messages).toEqual([]);
  });

  it('prints a located error with a repo-relative header and a line-prefixed detail', () => {
    const messages = captureErrors();
    const errors: ValidationError[] = [
      {
        message: 'bad thing',
        location: { file: `${ROOT}/src/foo.ts`, line: 12 },
      },
    ];
    printValidationErrors({ validationErrors: errors, repoRootDir: ROOT });
    // repoRootDir is stripped from the header; the detail is indented and prefixed
    // with the line number. Stored lines are 0-indexed and displayed 1-indexed,
    // so line 12 prints as "13:".
    expect(messages).toEqual(['src/foo.ts:', '  13: bad thing']);
  });

  it('prints the first line (0) with a "1:" prefix rather than dropping the line number', () => {
    const messages = captureErrors();
    const errors: ValidationError[] = [
      {
        message: 'top of file',
        location: { file: `${ROOT}/src/foo.ts`, line: 0 },
      },
    ];
    printValidationErrors({ validationErrors: errors, repoRootDir: ROOT });
    // line 0 is the first line; a truthiness check would drop the prefix, so the
    // number is rendered via an explicit typeof check and displayed as "1:".
    expect(messages).toEqual(['src/foo.ts:', '  1: top of file']);
  });

  it('groups multiple errors for the same file under a single header', () => {
    const messages = captureErrors();
    const file = `${ROOT}/src/foo.ts`;
    const errors: ValidationError[] = [
      { message: 'first', location: { file, line: 1 } },
      { message: 'second', location: { file, line: 4 } },
    ];
    printValidationErrors({ validationErrors: errors, repoRootDir: ROOT });
    // Lines are displayed 1-indexed, so 0-indexed 1 and 4 print as "2:"/"5:".
    expect(messages).toEqual(['src/foo.ts:', '  2: first', '  5: second']);
  });

  it('prints location-less errors under a Global header with no line prefix', () => {
    const messages = captureErrors();
    const errors: ValidationError[] = [{ message: 'no file for this one' }];
    printValidationErrors({ validationErrors: errors, repoRootDir: ROOT });
    // 'Global' has no repoRootDir prefix to strip, and with no location there is no
    // line number to prepend.
    expect(messages).toEqual(['Global:', '  no file for this one']);
  });

  it('groups multiple location-less errors under a single Global header', () => {
    const messages = captureErrors();
    const errors: ValidationError[] = [
      { message: 'alpha' },
      { message: 'beta' },
    ];
    printValidationErrors({ validationErrors: errors, repoRootDir: ROOT });
    expect(messages).toEqual(['Global:', '  alpha', '  beta']);
  });

  it('prints located and Global errors under their own headers', () => {
    const messages = captureErrors();
    const errors: ValidationError[] = [
      { message: 'located', location: { file: `${ROOT}/a.ts`, line: 2 } },
      { message: 'floating' },
    ];
    printValidationErrors({ validationErrors: errors, repoRootDir: ROOT });
    expect(messages).toEqual([
      'a.ts:',
      '  3: located',
      'Global:',
      '  floating',
    ]);
  });
});
