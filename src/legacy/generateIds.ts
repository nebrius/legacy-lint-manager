import { nanoid } from 'nanoid';

import { ID_LENGTH } from '../util/constants.js';

export function generateId(previousId?: string) {
  return previousId ?? nanoid(ID_LENGTH);
}
