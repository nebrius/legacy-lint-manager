import type { DatabaseContents } from '../util/db.js';
import type { LegacyComment, ValidationError } from '../util/types.js';

export function buildDatabase({
  legacyComments,
  validationErrors,
}: {
  legacyComments: LegacyComment[];
  validationErrors: ValidationError[];
}): DatabaseContents {
  const database: Map<string, string[]> = new Map();
  for (const legacyComment of legacyComments) {
    if (database.has(legacyComment.id)) {
      validationErrors.push({
        message: `Duplicate legacy ID "${legacyComment.id}". Each legacy ID can only be used once.`,
        location: {
          file: legacyComment.file,
          line: legacyComment.startLine,
        },
      });
    }
    database.set(legacyComment.id, legacyComment.legaciedRules);
  }
  return Array.from(database.entries());
}
