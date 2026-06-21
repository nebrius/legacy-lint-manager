import type { LegacyComment, ValidationError } from '../types.js';
import type { Database } from '../util/db.js';

export function validateIds({
  database,
  validationErrors,
  legacyComments,
}: {
  database: Database;
  validationErrors: ValidationError[];
  legacyComments: LegacyComment[];
}) {
  // Create the map form of the database used to set what was found in code
  const databaseMap = new Map<string, boolean>();
  for (const id of database.getIds()) {
    databaseMap.set(id, false);
  }

  // Compare the database to the found comments
  for (const comment of legacyComments) {
    // Check if the ID is in the database (aka is a known legacy)
    if (databaseMap.has(comment.id)) {
      // Check if the ID was already found, aka the same ID was used more than once
      if (databaseMap.get(comment.id)) {
        validationErrors.push({
          message: `Duplicate legacy ID "${comment.id}". Each legacy ID can only be used once.`,
          file: comment.file,
          line: comment.line,
        });
      } else {
        databaseMap.set(comment.id, true);
      }
    } else {
      validationErrors.push({
        message: `Unregistered legacy error. New errors cannot be legacied.`,
        file: comment.file,
        line: comment.line,
      });
    }
  }

  // Return the list IDs in the database that were found in the code (aka
  // what the new value of ids should be in the database)
  return {
    usedIds: Array.from(databaseMap.entries())
      .filter(([, found]) => found)
      .map(([id]) => id),
    unusedIds: Array.from(databaseMap.entries())
      .filter(([, found]) => !found)
      .map(([id]) => id),
  };
}
