import type { Database } from '../util/db.js';
import type {
  LegacyComment,
  NonLegacyComment,
  ValidationError,
} from '../util/types.js';
import type { CompareInfo } from './getCompareInfo.js';

export function validateDisableComments({
  database,
  nonDisableableRules,
  validationErrors,
  legacyComments,
  nonLegacyComments,
  compareData,
}: {
  database: Database;
  nonDisableableRules: string[];
  validationErrors: ValidationError[];
  legacyComments: LegacyComment[];
  nonLegacyComments: NonLegacyComment[];
  compareData: CompareInfo | undefined;
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
          line: comment.startLine,
        });
      } else if (compareData && !compareData.expectedIds.has(comment.id)) {
        validationErrors.push({
          message: `Legacy ID "${comment.id}" is not present in ${compareData.compareBranchName}. New legacied statements are not allowed`,
          file: comment.file,
          line: comment.startLine,
        });
      } else {
        databaseMap.set(comment.id, true);
      }
    } else {
      validationErrors.push({
        message: `Unregistered legacy error. New errors cannot be legacied.`,
        file: comment.file,
        line: comment.startLine,
      });
    }
  }

  // Validate non-disableable rules are not used in legacy comments
  for (const comment of legacyComments) {
    for (const rule of comment.nonLegaciedRules) {
      if (nonDisableableRules.includes(rule)) {
        validationErrors.push({
          message: `Rule "${rule}" cannot be disabled.`,
          file: comment.file,
          line: comment.startLine,
        });
      }
    }
  }

  // Validate non-disableable rules are not used in non-legacy comments
  for (const comment of nonLegacyComments) {
    for (const rule of comment.rules) {
      if (nonDisableableRules.includes(rule)) {
        validationErrors.push({
          message: `Rule "${rule}" cannot be disabled.`,
          file: comment.file,
          line: comment.startLine,
        });
      }
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
