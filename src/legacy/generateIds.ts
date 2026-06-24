import { nanoid } from 'nanoid';

const idSet = new Set<string>();
export function generateId(previousId?: string) {
  let id = previousId ?? nanoid(8);

  // It is very unlikely that we'll ever have a collision, but given that
  // collisions are fatal, we store all generated IDs in a set to prevent them.
  // In theory, this could lead to a previous Id being rewritten to a new ID if
  // a previous ID encountered a collision, but this is an acceptible trade-off
  // given that to always preserve IDs requires first knowing the entire list
  // before we generate a single ID, which would be much more computationally
  while (idSet.has(id)) {
    id = nanoid(8);
  }
  idSet.add(id);
  return id;
}

export function getIds() {
  return Array.from(idSet).sort();
}
