import { nanoid } from 'nanoid';

import { ID_LENGTH } from '../util/constants.js';

const ids = new Map<string, string[]>();

export function generateId({
  previousId,
  rules,
}: {
  previousId?: string;
  rules: string[];
}) {
  let id = previousId ?? nanoid(ID_LENGTH);

  // It is very unlikely that we'll ever have a collision, but given that
  // collisions are fatal, we store all generated IDs in a set to prevent them.
  // In theory, this could lead to a previous Id being rewritten to a new ID if
  // a previous ID encountered a collision, but this is an acceptable trade-off
  // given that to always preserve IDs requires first knowing the entire list
  // before we generate a single ID, which would be much more computationally
  while (ids.has(id)) {
    id = nanoid(ID_LENGTH);
  }
  ids.set(id, rules);
  return id;
}

export function getIds() {
  return ids;
}
