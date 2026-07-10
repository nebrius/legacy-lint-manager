import { expect } from 'vitest';

import type { LegacyComment, NonLegacyComment } from '../../util/types.js';

// Narrows a parseDisableComment result to a LegacyComment, failing the test
// with a readable type mismatch when it is undefined or non-legacy. This keeps
// property assertions direct instead of the `x?.type === 'legacy' && x.prop`
// conditional form, whose failures collapse to "expected false to equal ...".
export function asLegacy(
  comment: LegacyComment | NonLegacyComment | undefined
): LegacyComment {
  expect(comment?.type).toBe('legacy');
  return comment as LegacyComment;
}
