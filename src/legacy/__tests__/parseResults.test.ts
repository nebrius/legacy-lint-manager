import { describe, expect, it } from 'vitest';

import { parseResults } from '../parseResults.js';

// --- ESLint input builders ------------------------------------------------

function eslintMessage(ruleId: string, line: number) {
  return { ruleId, line };
}

function eslintFile(
  filePath: string,
  messages: Array<{ ruleId: string; line: number }>
) {
  return { filePath, messages };
}

// --- Oxlint input builders ------------------------------------------------

function spanLabel(line: number) {
  return { span: { line } };
}

function oxlintDiagnostic(
  code: string | undefined,
  filename: string,
  labels: unknown[]
) {
  const diagnostic: Record<string, unknown> = {
    message: 'lint violation',
    filename,
    labels,
  };
  // A real diagnostic omits `code` entirely when the error happened before
  // linting (e.g. a syntax error), so only attach it when provided.
  if (code !== undefined) {
    diagnostic.code = code;
  }
  return diagnostic;
}

function oxlintResults(diagnostics: unknown[]) {
  return { diagnostics };
}

describe('parseResults', () => {
  describe('ESLint output', () => {
    it('normalizes a single error and converts the 1-indexed line to 0-indexed', () => {
      const results = [
        eslintFile('src/a.ts', [eslintMessage('no-console', 1)]),
      ];
      expect(parseResults(results)).toEqual({
        type: 'eslint',
        errors: new Map([['src/a.ts', new Map([[0, ['no-console']]])]]),
      });
    });

    it('groups multiple rules reported on the same line in encounter order', () => {
      const results = [
        eslintFile('src/a.ts', [
          eslintMessage('no-console', 3),
          eslintMessage('no-debugger', 3),
        ]),
      ];
      expect(parseResults(results)).toEqual({
        type: 'eslint',
        errors: new Map([
          ['src/a.ts', new Map([[2, ['no-console', 'no-debugger']]])],
        ]),
      });
    });

    it('keeps separate entries for errors on different lines', () => {
      const results = [
        eslintFile('src/a.ts', [
          eslintMessage('no-console', 2),
          eslintMessage('no-debugger', 5),
        ]),
      ];
      expect(parseResults(results)).toEqual({
        type: 'eslint',
        errors: new Map([
          [
            'src/a.ts',
            new Map([
              [1, ['no-console']],
              [4, ['no-debugger']],
            ]),
          ],
        ]),
      });
    });

    it('does not de-duplicate identical rules reported twice on the same line', () => {
      const results = [
        eslintFile('src/a.ts', [
          eslintMessage('no-console', 2),
          eslintMessage('no-console', 2),
        ]),
      ];
      expect(parseResults(results)).toEqual({
        type: 'eslint',
        errors: new Map([
          ['src/a.ts', new Map([[1, ['no-console', 'no-console']]])],
        ]),
      });
    });

    it('normalizes errors spread across multiple files', () => {
      const results = [
        eslintFile('src/a.ts', [eslintMessage('no-console', 2)]),
        eslintFile('src/b.ts', [eslintMessage('no-debugger', 4)]),
      ];
      expect(parseResults(results)).toEqual({
        type: 'eslint',
        errors: new Map([
          ['src/a.ts', new Map([[1, ['no-console']]])],
          ['src/b.ts', new Map([[3, ['no-debugger']]])],
        ]),
      });
    });

    it('omits files that report no messages', () => {
      const results = [
        eslintFile('src/clean.ts', []),
        eslintFile('src/dirty.ts', [eslintMessage('no-console', 2)]),
      ];
      expect(parseResults(results)).toEqual({
        type: 'eslint',
        errors: new Map([['src/dirty.ts', new Map([[1, ['no-console']]])]]),
      });
    });

    it('returns an empty error map for an empty results array', () => {
      expect(parseResults([])).toEqual({
        type: 'eslint',
        errors: new Map(),
      });
    });

    it('tolerates the additional fields present in real ESLint JSON', () => {
      const results = [
        {
          filePath: '/abs/path/file.js',
          messages: [
            {
              ruleId: 'no-unused-vars',
              severity: 2,
              message: "'addOne' is defined but never used.",
              line: 1,
              column: 10,
              messageId: 'unusedVar',
              endLine: 1,
              endColumn: 16,
            },
          ],
          errorCount: 1,
          warningCount: 0,
          fixableErrorCount: 0,
          fixableWarningCount: 0,
          source: 'function addOne(i) {}\n',
        },
      ];
      expect(parseResults(results)).toEqual({
        type: 'eslint',
        errors: new Map([
          ['/abs/path/file.js', new Map([[0, ['no-unused-vars']]])],
        ]),
      });
    });

    it('captures warnings (severity 1) the same as errors', () => {
      // The parser does not filter on severity, so a warning is recorded just
      // like an error. (Whether warnings should instead be excluded is a
      // separate, source-side decision.)
      const results = [
        {
          filePath: 'w.ts',
          messages: [{ ruleId: 'no-console', line: 2, severity: 1 }],
        },
      ];
      expect(parseResults(results)).toEqual({
        type: 'eslint',
        errors: new Map([['w.ts', new Map([[1, ['no-console']]])]]),
      });
    });
  });

  describe('Oxlint output', () => {
    it('normalizes a single diagnostic and converts the 1-indexed line to 0-indexed', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-debugger)', 'test.js', [spanLabel(5)]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([['test.js', new Map([[4, ['eslint/no-debugger']]])]]),
      });
    });

    it('rewrites a plugin-scoped code into a slash-separated rule name', () => {
      const results = oxlintResults([
        oxlintDiagnostic('typescript(no-explicit-any)', 'test.ts', [
          spanLabel(10),
        ]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([
          ['test.ts', new Map([[9, ['typescript/no-explicit-any']]])],
        ]),
      });
    });

    it('skips diagnostics that have no code (e.g. syntax errors)', () => {
      const results = oxlintResults([
        oxlintDiagnostic(undefined, 'broken.ts', [spanLabel(2)]),
        oxlintDiagnostic('eslint(no-console)', 'broken.ts', [spanLabel(5)]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([['broken.ts', new Map([[4, ['eslint/no-console']]])]]),
      });
    });

    it('returns an empty error map when every diagnostic lacks a code', () => {
      const results = oxlintResults([
        oxlintDiagnostic(undefined, 'broken.ts', [spanLabel(2)]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map(),
      });
    });

    it('groups multiple rules reported on the same line in encounter order', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-console)', 'test.js', [spanLabel(7)]),
        oxlintDiagnostic('eslint(no-debugger)', 'test.js', [spanLabel(7)]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([
          [
            'test.js',
            new Map([[6, ['eslint/no-console', 'eslint/no-debugger']]]),
          ],
        ]),
      });
    });

    it('normalizes diagnostics spread across multiple files and lines', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-console)', 'a.ts', [spanLabel(3)]),
        oxlintDiagnostic('eslint(no-debugger)', 'b.ts', [spanLabel(9)]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([
          ['a.ts', new Map([[2, ['eslint/no-console']]])],
          ['b.ts', new Map([[8, ['eslint/no-debugger']]])],
        ]),
      });
    });

    it('ignores labels that do not contain a span when locating the line', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-console)', 'test.js', [
          'not a span',
          { unrelated: true },
          spanLabel(5),
        ]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([['test.js', new Map([[4, ['eslint/no-console']]])]]),
      });
    });

    it('uses the line from the last span label when several are present', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-console)', 'test.js', [
          spanLabel(3),
          spanLabel(8),
        ]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([['test.js', new Map([[7, ['eslint/no-console']]])]]),
      });
    });

    it('returns an empty error map for an empty diagnostics array', () => {
      expect(parseResults(oxlintResults([]))).toEqual({
        type: 'oxlint',
        errors: new Map(),
      });
    });

    it('tolerates the additional fields present in real Oxlint JSON', () => {
      const results = {
        diagnostics: [
          {
            message: '`debugger` statement is not allowed',
            code: 'eslint(no-debugger)',
            severity: 'error',
            causes: [],
            url: 'https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html',
            help: 'Remove the debugger statement',
            filename: 'test.js',
            labels: [{ span: { offset: 38, length: 9, line: 5, column: 1 } }],
            related: [],
          },
        ],
        number_of_files: 1,
        number_of_rules: 2,
        threads_count: 1,
        start_time: 0.0186,
      };
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([['test.js', new Map([[4, ['eslint/no-debugger']]])]]),
      });
    });

    // Boundary: a line-1 (1-indexed) error must normalize to index 0.
    it('normalizes an Oxlint error on the first line to index 0', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-debugger)', 'test.js', [spanLabel(1)]),
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([['test.js', new Map([[0, ['eslint/no-debugger']]])]]),
      });
    });

    it('captures warnings (severity "warning") the same as errors', () => {
      // Severity is never consulted; a warning is recorded like any other
      // diagnostic.
      const results = oxlintResults([
        {
          ...oxlintDiagnostic('eslint(no-console)', 'w.ts', [spanLabel(2)]),
          severity: 'warning',
        },
      ]);
      expect(parseResults(results)).toEqual({
        type: 'oxlint',
        errors: new Map([['w.ts', new Map([[1, ['eslint/no-console']]])]]),
      });
    });
  });

  describe('unrecognized input', () => {
    it('throws for an empty object', () => {
      expect(() => parseResults({})).toThrow('Could not parse piped results');
    });

    it('throws for null', () => {
      expect(() => parseResults(null)).toThrow('Could not parse piped results');
    });

    it('throws for undefined', () => {
      expect(() => parseResults(undefined)).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws for a primitive string', () => {
      expect(() => parseResults('oops')).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws for a primitive number', () => {
      expect(() => parseResults(42)).toThrow('Could not parse piped results');
    });

    it('throws for an array whose entries are not ESLint messages', () => {
      expect(() => parseResults([{ foo: 'bar' }])).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws when an ESLint message is missing its line number', () => {
      const results = [
        { filePath: 'a.ts', messages: [{ ruleId: 'no-console' }] },
      ];
      expect(() => parseResults(results)).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws when an Oxlint diagnostic is missing its filename', () => {
      const results = {
        diagnostics: [
          { message: 'm', code: 'eslint(no-console)', labels: [spanLabel(5)] },
        ],
      };
      expect(() => parseResults(results)).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws for an ESLint message whose ruleId is null (fatal parse error)', () => {
      // Real `eslint --format=json` emits `ruleId: null` for a file that fails
      // to parse. The schema requires a string ruleId, so the whole batch is
      // rejected and parsing throws. This is the accepted behavior, and is
      // asymmetric with the Oxlint branch, which instead skips its no-code
      // (pre-lint error) diagnostics.
      const results = [
        { filePath: 'a.ts', messages: [{ ruleId: null, line: 1 }] },
      ];
      expect(() => parseResults(results)).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws when an ESLint message is missing its ruleId', () => {
      const results = [{ filePath: 'a.ts', messages: [{ line: 1 }] }];
      expect(() => parseResults(results)).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws when an Oxlint diagnostic is missing its labels', () => {
      const results = {
        diagnostics: [
          { message: 'm', code: 'eslint(no-console)', filename: 'a.ts' },
        ],
      };
      expect(() => parseResults(results)).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws when Oxlint diagnostics is not an array', () => {
      expect(() => parseResults({ diagnostics: 'nope' })).toThrow(
        'Could not parse piped results'
      );
    });

    it('throws for a boolean', () => {
      expect(() => parseResults(true)).toThrow('Could not parse piped results');
    });
  });
});
