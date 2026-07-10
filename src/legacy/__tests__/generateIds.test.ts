import { describe, expect, it } from 'vitest';

import { makeId } from '../../__tests__/helpers/ids.js';
import { ID_LENGTH } from '../../util/constants.js';
import { generateId } from '../generateIds.js';

// generateId hands back a supplied previous id unchanged, or mints a fresh one.
// The real nanoid is used so these assert the product's actual output contract:
// id shape, distinctness, and previous-id passthrough.
describe('generateId', () => {
  it('mints an id of ID_LENGTH characters from the id alphabet when no previous id is supplied', () => {
    expect(generateId()).toMatch(
      new RegExp(`^[\\w-]{${ID_LENGTH.toString()}}$`)
    );
  });

  it('mints a distinct id on each call', () => {
    expect(generateId()).not.toBe(generateId());
  });

  it('returns the supplied previous id untouched', () => {
    expect(generateId(makeId('reused'))).toBe(makeId('reused'));
  });
});
