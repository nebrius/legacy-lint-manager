import TypeBox from 'typebox';
import { describe, expect, it } from 'vitest';

import { validateSchema } from '../validateSchema.js';

const ObjectSchema = TypeBox.Object(
  {
    a: TypeBox.String(),
    b: TypeBox.String(),
  },
  { additionalProperties: false }
);

describe('validateSchema', () => {
  it('returns the data unchanged when it matches the schema', () => {
    const data = { a: 'x', b: 'y' };
    expect(
      validateSchema({ schema: ObjectSchema, data, errorPrefix: 'Invalid' })
    ).toEqual(data);
  });

  it('appends a single error inline after the prefix', () => {
    expect(() =>
      validateSchema({
        schema: TypeBox.Array(TypeBox.String()),
        data: ['ok', 42],
        errorPrefix: 'Invalid thing:',
      })
    ).toThrow('Invalid thing: must be string');
  });

  it('lists every error on its own line when there are multiple', () => {
    // Two non-string elements yield two distinct "must be string" errors,
    // exercising the multi-error formatting branch.
    expect(() =>
      validateSchema({
        schema: TypeBox.Array(TypeBox.String()),
        data: [1, 2],
        errorPrefix: 'Invalid thing:',
      })
    ).toThrow('Invalid thing:\n  must be string\n  must be string');
  });
});
