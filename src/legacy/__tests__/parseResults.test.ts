import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseResults } from '../parseResults.js';

// parseResults normalizes every linter-reported filename to an absolute path,
// resolving a relative name against process.cwd(). The fixtures below feed
// relative names (as Oxlint really emits), so the expected map keys are the
// cwd-resolved absolute paths. An already-absolute input is passed through
// unchanged (see the '/abs/path/file.js' and absolute-Oxlint cases).
const abs = (name: string) => resolve(process.cwd(), name);

// --- ESLint input builders ------------------------------------------------

// severity follows ESLint's convention: 1 = warning, 2 = error. It defaults to
// error so the existing tests (which all expect the message to be recorded)
// keep passing now that parseResults skips messages without a severity.
function eslintMessage(ruleId: string | null, line?: number, severity = 2) {
  return { ruleId, line, severity };
}

function eslintFile(
  filePath: string,
  messages: Array<{ ruleId: string | null; line?: number; severity?: number }>
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
  labels: unknown[],
  severity: 'error' | 'warning' = 'error'
) {
  const diagnostic: Record<string, unknown> = {
    message: 'lint violation',
    filename,
    labels,
    // severity is required by the schema; default to error so existing tests
    // keep recording the diagnostic.
    severity,
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
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([[abs('src/a.ts'), new Map([[0, ['no-console']]])]]),
      });
    });

    it('groups multiple rules reported on the same line in encounter order', () => {
      const results = [
        eslintFile('src/a.ts', [
          eslintMessage('no-console', 3),
          eslintMessage('no-debugger', 3),
        ]),
      ];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([
          [abs('src/a.ts'), new Map([[2, ['no-console', 'no-debugger']]])],
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
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([
          [
            abs('src/a.ts'),
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
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([
          [abs('src/a.ts'), new Map([[1, ['no-console', 'no-console']]])],
        ]),
      });
    });

    it('normalizes errors spread across multiple files', () => {
      const results = [
        eslintFile('src/a.ts', [eslintMessage('no-console', 2)]),
        eslintFile('src/b.ts', [eslintMessage('no-debugger', 4)]),
      ];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([
          [abs('src/a.ts'), new Map([[1, ['no-console']]])],
          [abs('src/b.ts'), new Map([[3, ['no-debugger']]])],
        ]),
      });
    });

    it('omits files that report no messages', () => {
      const results = [
        eslintFile('src/clean.ts', []),
        eslintFile('src/dirty.ts', [eslintMessage('no-console', 2)]),
      ];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([
          [abs('src/dirty.ts'), new Map([[1, ['no-console']]])],
        ]),
      });
    });

    it('returns an empty error map for an empty results array', () => {
      expect(
        parseResults({
          results: [],
          ignoreWarnings: false,
          linterType: 'eslint',
        })
      ).toEqual({
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
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([
          ['/abs/path/file.js', new Map([[0, ['no-unused-vars']]])],
        ]),
      });
    });

    it('records warnings (severity 1) like errors when ignoreWarnings is false', () => {
      const results = [eslintFile('w.ts', [eslintMessage('no-console', 2, 1)])];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([[abs('w.ts'), new Map([[1, ['no-console']]])]]),
      });
    });

    it('drops warnings (severity 1) but keeps errors when ignoreWarnings is true', () => {
      const results = [
        eslintFile('mixed.ts', [
          eslintMessage('no-console', 2, 1),
          eslintMessage('no-debugger', 5, 2),
        ]),
      ];
      expect(
        parseResults({ results, ignoreWarnings: true, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([[abs('mixed.ts'), new Map([[4, ['no-debugger']]])]]),
      });
    });

    it('skips a message with no severity even when ignoreWarnings is false', () => {
      // Real ESLint always emits severity; a message lacking it can't be
      // classified as warning vs error, so it is skipped rather than recorded.
      const results = [
        { filePath: 'nosev.ts', messages: [{ ruleId: 'no-console', line: 2 }] },
      ];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map(),
      });
    });

    // Real `eslint --format=json` emits a message with `ruleId: null` and no
    // line when a file fails to parse. There's no rule to legacy, so the
    // message is skipped rather than recorded or treated as a parse failure.
    it('skips a message whose ruleId is null (fatal parse error)', () => {
      const results = [eslintFile('broken.ts', [eslintMessage(null, 1)])];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map(),
      });
    });

    it('skips a message that has no line', () => {
      const results = [eslintFile('broken.ts', [eslintMessage('no-console')])];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map(),
      });
    });

    it('keeps real errors while skipping a parse-error message in the same file', () => {
      const results = [
        eslintFile('mixed.ts', [
          eslintMessage(null, 1),
          eslintMessage('no-console', 2),
        ]),
      ];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([[abs('mixed.ts'), new Map([[1, ['no-console']]])]]),
      });
    });

    it('skips a parse-error message in one file while still recording a valid file', () => {
      // Skipping is per-message: a file that only reports a parse error is
      // omitted, but a well-formed file in the same batch is still recorded.
      const results = [
        eslintFile('good.ts', [eslintMessage('no-console', 2)]),
        eslintFile('bad.ts', [eslintMessage(null)]),
      ];
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toEqual({
        type: 'eslint',
        errors: new Map([[abs('good.ts'), new Map([[1, ['no-console']]])]]),
      });
    });
  });

  describe('Oxlint output', () => {
    it('normalizes a single diagnostic and converts the 1-indexed line to 0-indexed', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-debugger)', 'test.js', [spanLabel(5)]),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('test.js'), new Map([[4, ['eslint/no-debugger']]])],
        ]),
      });
    });

    // Oxlint normally emits cwd-relative filenames, but an already-absolute
    // filename must be used as the map key verbatim (isAbsolute short-circuits
    // the resolve), so a second cwd resolution can never mangle it.
    it('uses an already-absolute filename as the key unchanged', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-debugger)', '/abs/path/test.js', [
          spanLabel(5),
        ]),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          ['/abs/path/test.js', new Map([[4, ['eslint/no-debugger']]])],
        ]),
      });
    });

    it('rewrites a plugin-scoped code into a slash-separated rule name', () => {
      const results = oxlintResults([
        oxlintDiagnostic('typescript(no-explicit-any)', 'test.ts', [
          spanLabel(10),
        ]),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('test.ts'), new Map([[9, ['typescript/no-explicit-any']]])],
        ]),
      });
    });

    it('skips diagnostics that have no code (e.g. syntax errors)', () => {
      const results = oxlintResults([
        oxlintDiagnostic(undefined, 'broken.ts', [spanLabel(2)]),
        oxlintDiagnostic('eslint(no-console)', 'broken.ts', [spanLabel(5)]),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('broken.ts'), new Map([[4, ['eslint/no-console']]])],
        ]),
      });
    });

    it('returns an empty error map when every diagnostic lacks a code', () => {
      const results = oxlintResults([
        oxlintDiagnostic(undefined, 'broken.ts', [spanLabel(2)]),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map(),
      });
    });

    it('groups multiple rules reported on the same line in encounter order', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-console)', 'test.js', [spanLabel(7)]),
        oxlintDiagnostic('eslint(no-debugger)', 'test.js', [spanLabel(7)]),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [
            abs('test.js'),
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
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('a.ts'), new Map([[2, ['eslint/no-console']]])],
          [abs('b.ts'), new Map([[8, ['eslint/no-debugger']]])],
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
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('test.js'), new Map([[4, ['eslint/no-console']]])],
        ]),
      });
    });

    it('uses the line from the last span label when several are present', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-console)', 'test.js', [
          spanLabel(3),
          spanLabel(8),
        ]),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('test.js'), new Map([[7, ['eslint/no-console']]])],
        ]),
      });
    });

    it('returns an empty error map for an empty diagnostics array', () => {
      expect(
        parseResults({
          results: oxlintResults([]),
          ignoreWarnings: false,
          linterType: 'oxlint',
        })
      ).toEqual({
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
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('test.js'), new Map([[4, ['eslint/no-debugger']]])],
        ]),
      });
    });

    // Boundary: a line-1 (1-indexed) error must normalize to index 0.
    it('normalizes an Oxlint error on the first line to index 0', () => {
      const results = oxlintResults([
        oxlintDiagnostic('eslint(no-debugger)', 'test.js', [spanLabel(1)]),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('test.js'), new Map([[0, ['eslint/no-debugger']]])],
        ]),
      });
    });

    it('records warnings like errors when ignoreWarnings is false', () => {
      const results = oxlintResults([
        oxlintDiagnostic(
          'eslint(no-console)',
          'w.ts',
          [spanLabel(2)],
          'warning'
        ),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([[abs('w.ts'), new Map([[1, ['eslint/no-console']]])]]),
      });
    });

    it('drops warnings but keeps errors when ignoreWarnings is true', () => {
      const results = oxlintResults([
        oxlintDiagnostic(
          'eslint(no-console)',
          'mixed.ts',
          [spanLabel(2)],
          'warning'
        ),
        oxlintDiagnostic(
          'eslint(no-debugger)',
          'mixed.ts',
          [spanLabel(5)],
          'error'
        ),
      ]);
      expect(
        parseResults({ results, ignoreWarnings: true, linterType: 'oxlint' })
      ).toEqual({
        type: 'oxlint',
        errors: new Map([
          [abs('mixed.ts'), new Map([[4, ['eslint/no-debugger']]])],
        ]),
      });
    });
  });

  describe('unrecognized input', () => {
    // With linterType 'oxlint', malformed input is run against the Oxlint
    // schema, so the failing check reports an Oxlint parse error.
    it('throws for an empty object', () => {
      expect(() =>
        parseResults({
          results: {},
          ignoreWarnings: false,
          linterType: 'oxlint',
        })
      ).toThrow('Could not parse piped Oxlint results');
    });

    it('throws for null', () => {
      expect(() =>
        parseResults({
          results: null,
          ignoreWarnings: false,
          linterType: 'oxlint',
        })
      ).toThrow('Could not parse piped Oxlint results');
    });

    it('throws for undefined', () => {
      expect(() =>
        parseResults({
          results: undefined,
          ignoreWarnings: false,
          linterType: 'oxlint',
        })
      ).toThrow('Could not parse piped Oxlint results');
    });

    it('throws for a primitive string', () => {
      expect(() =>
        parseResults({
          results: 'oops',
          ignoreWarnings: false,
          linterType: 'oxlint',
        })
      ).toThrow('Could not parse piped Oxlint results');
    });

    it('throws for a primitive number', () => {
      expect(() =>
        parseResults({
          results: 42,
          ignoreWarnings: false,
          linterType: 'oxlint',
        })
      ).toThrow('Could not parse piped Oxlint results');
    });

    it('throws for a boolean', () => {
      expect(() =>
        parseResults({
          results: true,
          ignoreWarnings: false,
          linterType: 'oxlint',
        })
      ).toThrow('Could not parse piped Oxlint results');
    });

    // With linterType 'eslint', malformed input is run against the ESLint
    // schema, so the failing check reports an ESLint parse error.
    it('throws for an array whose entries are not ESLint messages', () => {
      expect(() =>
        parseResults({
          results: [{ foo: 'bar' }],
          ignoreWarnings: false,
          linterType: 'eslint',
        })
      ).toThrow('Could not parse piped ESLint results');
    });

    it('throws when an ESLint message is missing its ruleId', () => {
      // `ruleId` is required (only nullable), so omitting it entirely still
      // fails the schema, unlike a null ruleId, which is skipped.
      const results = [{ filePath: 'a.ts', messages: [{ line: 1 }] }];
      expect(() =>
        parseResults({ results, ignoreWarnings: false, linterType: 'eslint' })
      ).toThrow('Could not parse piped ESLint results');
    });

    it('throws when an Oxlint diagnostic is missing its filename', () => {
      const results = {
        diagnostics: [
          { message: 'm', code: 'eslint(no-console)', labels: [spanLabel(5)] },
        ],
      };
      expect(() =>
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toThrow('Could not parse piped Oxlint results');
    });

    it('throws when an Oxlint diagnostic is missing its labels', () => {
      const results = {
        diagnostics: [
          { message: 'm', code: 'eslint(no-console)', filename: 'a.ts' },
        ],
      };
      expect(() =>
        parseResults({ results, ignoreWarnings: false, linterType: 'oxlint' })
      ).toThrow('Could not parse piped Oxlint results');
    });

    it('throws when Oxlint diagnostics is not an array', () => {
      expect(() =>
        parseResults({
          results: { diagnostics: 'nope' },
          ignoreWarnings: false,
          linterType: 'oxlint',
        })
      ).toThrow('Could not parse piped Oxlint results');
    });
  });
});
