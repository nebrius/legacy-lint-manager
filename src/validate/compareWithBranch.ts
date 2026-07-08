import { execSync } from 'node:child_process';

import type { Config } from '../util/config.js';
import { parseConfig } from '../util/config.js';
import type { Database } from '../util/db.js';
import { createDatabase } from '../util/db.js';
import { getUnprefixedRelativeDir } from '../util/files.js';
import type { ValidationError } from '../util/types.js';

type CompareInfo = {
  compareDatabase: Database;
  compareBranchName: string;
  compareConfig: Config;
};

export function compareWithBranch({
  currentDatabase,
  currentConfig,
  configFilePath,
  validationErrors,
  rootDir,
}: {
  currentDatabase: Database;
  currentConfig: Config;
  configFilePath: string;
  validationErrors: ValidationError[];
  rootDir: string;
}) {
  const { compareBranchName, compareDatabase, compareConfig } = getCompareInfo({
    compareBranch: currentConfig.compareBranch,
    configFilePath,
    rootDir,
  });

  // Ensure all IDs in the current database exist in the compare database
  for (const [id, rules] of currentDatabase.getIds()) {
    const compareRules = compareDatabase.getIds().get(id);
    if (!compareRules) {
      validationErrors.push({
        message: `Legacy ID "${id}" does not exist in the database on ${compareBranchName}. New legacy entries cannot be added.`,
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
          message: `Rule "${rule}" for legacy ID "${id}" is not defined in the database on ${compareBranchName}. New rules cannot be added to existing legacy entries.`,
        });
      }
    }
  }

  // Ensure that load-bearing config options have not changed
  const {
    nonDisableableRules: currentNonDisableableRules,
    ignoreWarnings: currentIgnoreWarnings,
    pragma: currentPragma,
    compareBranch: currentCompareBranch,
  } = currentConfig;
  const {
    nonDisableableRules: compareNonDisableableRules,
    ignoreWarnings: compareIgnoreWarnings,
    pragma: comparePragma,
    compareBranch: compareCompareBranch,
  } = compareConfig;

  // Check that the compare branch is the same
  if (currentCompareBranch !== compareCompareBranch) {
    validationErrors.push({
      message: `The compare branch in the current config (${currentCompareBranch}) does not match the compare branch in the compare config (${compareCompareBranch}).`,
    });
  }

  // Check that the ignore warnings are the same
  if (currentIgnoreWarnings !== compareIgnoreWarnings) {
    validationErrors.push({
      message: `The ignore warnings in the current config do not match the ignore warnings in the compare config.`,
    });
  }

  // Check that the pragma is the same
  if (currentPragma !== comparePragma) {
    validationErrors.push({
      message: `The pragma in the current config does not match the pragma in the compare config.`,
    });
  }

  // Check that no non-disableable rules in the comapre branch were removed
  for (const rule of compareNonDisableableRules) {
    if (!currentNonDisableableRules.includes(rule)) {
      validationErrors.push({
        message: `The non-disableable rule "${rule}" is not defined in the current config. Non-disableable rules cannot be removed from the compare branch.`,
      });
    }
  }
}

function getCompareInfo({
  compareBranch,
  configFilePath,
  rootDir,
}: {
  compareBranch: string;
  configFilePath: string;
  rootDir: string;
}): CompareInfo {
  // Read in the config from the compare branch
  const compareConfigContent = execSync(
    `git show ${compareBranch}:${getUnprefixedRelativeDir({ path: configFilePath, rootDir })}`,
    {
      encoding: 'utf-8',
      cwd: rootDir,
    }
  );
  const compareConfig = parseConfig({
    configFilePath,
    configFileContents: compareConfigContent,
  });

  // Read in the database from the compare branch, using the compare config
  // to track potential renames of the database file
  const compareDatabaseContent = execSync(
    `git show ${compareBranch}:${getUnprefixedRelativeDir({ path: compareConfig.databaseFile, rootDir })}`,
    {
      encoding: 'utf-8',
      cwd: rootDir,
    }
  );
  const compareDatabase = createDatabase({
    filePath: undefined,
    databaseContents: JSON.parse(compareDatabaseContent) as unknown,
  });

  return {
    compareDatabase,
    compareConfig,
    compareBranchName: compareBranch,
  };
}
