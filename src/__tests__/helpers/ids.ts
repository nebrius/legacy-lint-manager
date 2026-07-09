import { ID_LENGTH } from '../../util/constants.js';

// A 32-char base of unique characters from the id alphabet. Long enough that
// slicing to ID_LENGTH never falls back to '0' padding. Call sites that don't
// care about the exact id value pass this EXPLICITLY (see makeId), so choosing
// the default is always a conscious decision rather than an implicit fallback.
export const DEFAULT_ID_BASE = 'abcdefghijklmnopqrstuvwxyz012345';

// Slices a base down to a valid id of exactly ID_LENGTH characters. `base` is
// required — there is no parameter default — so every call site consciously
// picks an id (a mnemonic like 'c0nsole' when the value matters, or
// DEFAULT_ID_BASE when it does not). padEnd is a defensive fallback that never
// fires while base is at least ID_LENGTH chars. Tracks ID_LENGTH so ids stay
// the right length if the constant changes.
export function makeId(base: string): string {
  return base.slice(0, ID_LENGTH).padEnd(ID_LENGTH, '0');
}

// Deterministic generator of distinct, fixed-width ids for nanoid mocks, so a
// mocked id matches real nanoid's length as ID_LENGTH changes. The fixed-width
// counter (not '0' padEnd) guarantees successive ids never collide.
export function idSequence(prefix = 'id'): () => string {
  let n = 0;
  return () =>
    `${prefix}${(++n).toString().padStart(ID_LENGTH - prefix.length, '0')}`;
}
