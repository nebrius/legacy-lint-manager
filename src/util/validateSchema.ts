import type TypeBox from 'typebox';
import type { TSchema } from 'typebox';
import Value from 'typebox/value';

export function validateSchema<T extends TSchema>({
  schema,
  data,
  errorPrefix,
}: {
  schema: T;
  data: unknown;
  errorPrefix: string;
}): TypeBox.Static<T> {
  if (!Value.Check(schema, data)) {
    let errorMessage = errorPrefix;
    const errors = Value.Errors(schema, data);
    if (errors.length === 1) {
      errorMessage += ' ' + errors[0].message;
    } else {
      for (const err of errors) {
        errorMessage += `\n  ${err.message}`;
      }
    }
    throw new Error(errorMessage);
  }
  return data;
}
