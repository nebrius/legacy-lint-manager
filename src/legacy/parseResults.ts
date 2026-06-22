import TypeBox from 'typebox';
import Value from 'typebox/value';

import type { LintErrors } from '../types.js';
import { InternalError } from '../util/error.js';

const EslintSchema = TypeBox.Array(
  TypeBox.Object({
    filePath: TypeBox.String(),
    messages: TypeBox.Array(
      TypeBox.Object({
        ruleId: TypeBox.String(),
        line: TypeBox.Number(),
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
    })
  ),
});

const SpanSchema = TypeBox.Object({
  span: TypeBox.Object({
    line: TypeBox.Number(),
  }),
});

const OXLINT_CODE_REGEX = /^(.*?)\((.*?)\)$/;

export function parseResults(results: unknown): LintErrors {
  if (Value.Check(EslintSchema, results)) {
    const lintErrors: LintErrors = new Map();
    for (const file of results) {
      const { filePath } = file;
      for (const message of file.messages) {
        if (!lintErrors.has(filePath)) {
          lintErrors.set(filePath, new Map());
        }
        // Guaranteed to exist due to the has check above
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const fileEntry = lintErrors.get(filePath)!;
        if (!fileEntry.has(message.line)) {
          fileEntry.set(message.line, []);
        }
        fileEntry.get(message.line)?.push(message.ruleId);
      }
    }
    return lintErrors;
  }
  if (Value.Check(OxlintSchema, results)) {
    const lintErrors: LintErrors = new Map();
    for (const diagnostic of results.diagnostics) {
      // A missing code means that an error happened before Oxlint was able to
      // lint the file, such as a syntax error. We don't care about these cases.
      if (!diagnostic.code) {
        continue;
      }

      // Find the line number in the labels.
      let lineNumber: number | undefined;
      for (const label of diagnostic.labels) {
        if (Value.Check(SpanSchema, label)) {
          lineNumber = label.span.line;
        }
      }

      /* istanbul ignore next */
      if (!lineNumber) {
        // This shouldn't be possible in practice
        const prettyError = JSON.stringify(diagnostic, null, 2)
          .split('\n')
          .join('  \n');
        throw new InternalError(
          `Could not determine line number for diagnostic:\n  ${prettyError}`
        );
      }

      // Save the lint error
      if (!lintErrors.has(diagnostic.filename)) {
        lintErrors.set(diagnostic.filename, new Map());
      }
      // Guaranteed to exist due to the has check above
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const fileEntry = lintErrors.get(diagnostic.filename)!;
      if (!fileEntry.has(lineNumber)) {
        fileEntry.set(lineNumber, []);
      }
      const codeParts = OXLINT_CODE_REGEX.exec(diagnostic.code);
      /* istanbul ignore next */
      if (!codeParts) {
        // This shouldn't be possible in practice
        throw new InternalError(
          `Could not parse diagnostic code ${diagnostic.code}`
        );
      }
      fileEntry.get(lineNumber)?.push(codeParts[1] + '/' + codeParts[2]);
    }
    return lintErrors;
  }
  throw new Error(
    'Could not parse piped results. Did you remember to add --forma=json when piping the output?'
  );
}
