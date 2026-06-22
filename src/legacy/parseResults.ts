import TypeBox from 'typebox';
import Value from 'typebox/value';

import type { LintError } from '../types.js';

const EslintSchema = TypeBox.Object({
  results: TypeBox.Array(
    TypeBox.Object({
      filePath: TypeBox.String(),
      messages: TypeBox.Array(
        TypeBox.Object({
          ruleId: TypeBox.String(),
          message: TypeBox.String(),
          line: TypeBox.Number(),
          column: TypeBox.Number(),
        })
      ),
    })
  ),
});

const OxlintSchema = TypeBox.Object({
  results: TypeBox.Array(
    TypeBox.Object({
      file_path: TypeBox.String(),
      messages: TypeBox.Array(
        TypeBox.Object({
          rule_id: TypeBox.String(),
          message: TypeBox.String(),
          line: TypeBox.Number(),
          column: TypeBox.Number(),
        })
      ),
    })
  ),
});

export function parseResults(results: unknown): LintError[] {
  if (Value.Check(EslintSchema, results)) {
    return results;
  }
  if (Value.Check(OxlintSchema, results)) {
    return results;
  }
  throw new Error('Could not parse piped results');
}
