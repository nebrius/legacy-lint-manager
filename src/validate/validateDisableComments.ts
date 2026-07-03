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
  // Create the map form of the database that maps from id in the database to
  // whether or not it was found in the code.
  const databaseMap = new Map<
    string,
    { foundInCode: boolean; rules: string[] }
  >();
  for (const [id, rules] of database.getIds()) {
    databaseMap.set(id, { foundInCode: false, rules });
  }

  // Compare the database to the found comments
  for (const comment of legacyComments) {
    // Check if the ID is in the database (aka is a known legacy)
    const mapEntry = databaseMap.get(comment.id);
    if (mapEntry) {
      // Check if the ID was already found, aka the same ID was used more than once
      if (mapEntry.foundInCode) {
        validationErrors.push({
          message: `Duplicate legacy ID "${comment.id}". Each legacy ID can only be used once.`,
          location: {
            file: comment.file,
            line: comment.startLine,
          },
        });
      } else {
        for (const rule of comment.legaciedRules) {
          if (!mapEntry.rules.includes(rule)) {
            validationErrors.push({
              message: `Rule "${rule}" for legacy ID "${comment.id}" is not defined in the database.`,
              location: {
                file: comment.file,
                line: comment.startLine,
              },
            });
          }
        }
        mapEntry.foundInCode = true;
      }
    } else {
      validationErrors.push({
        message: `Unregistered legacy error. New errors cannot be legacied.`,
        location: {
          file: comment.file,
          line: comment.startLine,
        },
      });
    }
  }

  // Validate non-disableable rules are not used in non-legacied rules in legacy comments
  for (const comment of legacyComments) {
    for (const rule of comment.nonLegaciedRules) {
      if (nonDisableableRules.includes(rule)) {
        validationErrors.push({
          message: `Rule "${rule}" cannot be disabled.`,
          location: {
            file: comment.file,
            line: comment.startLine,
          },
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
          location: {
            file: comment.file,
            line: comment.startLine,
          },
        });
      }
    }
  }

  // Comapare the database to the compare database
  if (compareData) {
    for (const [id, rules] of database.getIds()) {
      const compareRules = compareData.compareDatabase.getIds().get(id);
      if (!compareRules) {
        validationErrors.push({
          message: `Legacy ID "${id}" does not exist in the database on ${compareData.compareBranchName}. New legacy entries cannot be added.`,
        });
        continue;
      }

      // Confirm that no new rules were added to the database for an existing
      // legacy. We only do a 1-way check to validate that rules in the
      // current codebase are included in the compare database, but not the
      // other way around (aka that the current codebase is a subset of the
      // compare database). This is because the user might have fixed a lint
      // error that was previously legacied, which is allowed.
      for (const rule of rules) {
        if (!compareRules.includes(rule)) {
          validationErrors.push({
            message: `Rule "${rule}" for legacy ID "${id}" is not defined in the database on ${compareData.compareBranchName}. New rules cannot be added to existing legacy entries.`,
          });
        }
      }
    }
  }

  // Return the list IDs in the database that were found in the code (aka
  // what the new value of ids should be in the database)
  return {
    // Create the new version of IDs in the codebase, in database form
    ids: new Map(
      Array.from(databaseMap.entries())
        .filter(([, { foundInCode }]) => foundInCode)
        .map(([id, { rules }]) => [id, rules])
    ),
    wereErrorsFixed: databaseMap
      .entries()
      .some(([, { foundInCode }]) => !foundInCode),
  };
}
