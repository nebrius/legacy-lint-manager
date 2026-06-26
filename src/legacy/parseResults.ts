import TypeBox from 'typebox';
import Value from 'typebox/value';

import type { LintErrors } from '../types.js';
import { InternalError } from '../util/error.js';

const EslintSchema = TypeBox.Array(
  TypeBox.Object({
    filePath: TypeBox.String(),
    messages: TypeBox.Array(
      TypeBox.Object({
        // ruleId and line are missing for some top-level errors, such as file
        // parsing errors
        ruleId: TypeBox.Union([TypeBox.Null(), TypeBox.String()]),
        line: TypeBox.Optional(TypeBox.Number()),
        severity: TypeBox.Optional(TypeBox.Number()),
      })
    ),
  })
);

const OxlintSchema = TypeBox.Object({
  diagnostics: TypeBox.Array(
    TypeBox.Object({
      message: TypeBox.String(),
      code: TypeBox.Optional(TypeBox.String()),
      filename: TypeBox.String(),
      labels: TypeBox.Array(TypeBox.Unknown()),
      severity: TypeBox.Union([
        TypeBox.Literal('error'),
        TypeBox.Literal('warning'),
      ]),
    })
  ),
});

const SpanSchema = TypeBox.Object({
  span: TypeBox.Object({
    line: TypeBox.Number(),
  }),
});

const OXLINT_CODE_REGEX = /^(.*?)\((.*?)\)$/;

export function parseResults({
  results,
  ignoreWarnings,
}: {
  results: unknown;
  ignoreWarnings: boolean;
}): LintErrors {
  // ESLint diagnostics come in array form, while Oxlint errors come in an
  // object form, making it simple to determine which framework the results are
  if (Array.isArray(results)) {
    if (!Value.Check(EslintSchema, results)) {
      const errors = Value.Errors(EslintSchema, results);
      throw new InternalError(
        'Could not parse piped ESLint results: ' +
          JSON.stringify(Array.from(errors), null, 2)
      );
    }
    const lintErrors: LintErrors = { type: 'eslint', errors: new Map() };
    for (const file of results) {
      const { filePath } = file;
      for (const message of file.messages) {
        // A missing ruleId or line indicates the file couldn't be parsed, which
        // means there's nothing for us to legacy
        if (
          !message.ruleId ||
          message.line === undefined ||
          message.severity === undefined
        ) {
          continue;
        }
        if (ignoreWarnings && message.severity === 1) {
          continue;
        }
        if (!lintErrors.errors.has(filePath)) {
          lintErrors.errors.set(filePath, new Map());
        }
        // Guaranteed to exist due to the has check above
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const fileEntry = lintErrors.errors.get(filePath)!;
        // We want line numbers to be 0-indexed, not 1-indexed
        const line = message.line - 1;
        if (!fileEntry.has(line)) {
          fileEntry.set(line, []);
        }
        fileEntry.get(line)?.push(message.ruleId);
      }
    }
    return lintErrors;
  } else {
    if (!Value.Check(OxlintSchema, results)) {
      const errors = Value.Errors(OxlintSchema, results);
      throw new InternalError(
        'Could not parse piped Oxlint results: ' +
          JSON.stringify(Array.from(errors), null, 2)
      );
    }
    const lintErrors: LintErrors = { type: 'oxlint', errors: new Map() };
    for (const diagnostic of results.diagnostics) {
      // A missing code means that an error happened before Oxlint was able to
      // lint the file, such as a syntax error. We don't care about these cases.
      if (!diagnostic.code) {
        continue;
      }

      if (ignoreWarnings && diagnostic.severity === 'warning') {
        continue;
      }

      // Find the line number in the labels.
      let lineNumber: number | undefined;
      for (const label of diagnostic.labels) {
        if (Value.Check(SpanSchema, label)) {
          // We want line numbers to be 0-indexed, not 1-indexed
          lineNumber = label.span.line - 1;
        }
      }

      /* v8 ignore start */
      if (lineNumber === undefined) {
        // This shouldn't be possible in practice
        const prettyError = JSON.stringify(diagnostic, null, 2)
          .split('\n')
          .join('  \n');
        throw new InternalError(
          `Could not determine line number for diagnostic:\n  ${prettyError}`
        );
      }
      /* v8 ignore stop */

      // Save the lint error
      if (!lintErrors.errors.has(diagnostic.filename)) {
        lintErrors.errors.set(diagnostic.filename, new Map());
      }
      // Guaranteed to exist due to the has check above
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const fileEntry = lintErrors.errors.get(diagnostic.filename)!;
      if (!fileEntry.has(lineNumber)) {
        fileEntry.set(lineNumber, []);
      }
      const codeParts = OXLINT_CODE_REGEX.exec(diagnostic.code);
      /* v8 ignore start */
      if (!codeParts) {
        // This shouldn't be possible in practice
        throw new InternalError(
          `Could not parse diagnostic code ${diagnostic.code}`
        );
      }
      /* v8 ignore stop */
      fileEntry.get(lineNumber)?.push(codeParts[1] + '/' + codeParts[2]);
    }
    return lintErrors;
  }
}
