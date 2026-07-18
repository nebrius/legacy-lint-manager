import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from '../util/config.js';
import {
  parseConfig,
  parsePackageConfigOverride,
  readPackageConfigOverride,
} from '../util/config.js';
import { DEFAULT_CONFIG_FILE_NAME } from '../util/constants.js';
import type { Database } from '../util/db.js';
import { createDatabase } from '../util/db.js';
import { getUnprefixedRelativeDir } from '../util/files.js';
import { error } from '../util/logging.js';
import type { ValidationError } from '../util/types.js';

export function compareWithBranch({
  currentDatabase,
  currentConfig,
  configFilePath,
  validationErrors,
  repoRootDir,
  packageRootDirs,
}: {
  currentDatabase: Database;
  currentConfig: Config;
  configFilePath: string;
  validationErrors: ValidationError[];
  repoRootDir: string;
  packageRootDirs: string[] | undefined;
}) {
  const { compareDatabase, compareConfig, resolvedCompareBranchName } =
    getCompareInfo({
      compareBranchName: currentConfig.compareBranch,
      configFilePath,
      repoRootDir,
    });
  for (const [id, rules] of currentDatabase.getIds()) {
    const compareRules = compareDatabase.getIds().get(id);
    if (!compareRules) {
      validationErrors.push({
        message: `Legacy ID "${id}" does not exist in the database on ${currentConfig.compareBranch}. New legacy entries cannot be added.`,
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
          message: `Rule "${rule}" for legacy ID "${id}" is not defined in the database on ${currentConfig.compareBranch}. New rules cannot be added to existing legacy entries.`,
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
    monorepoConfig: currentMonorepoConfig,
  } = currentConfig;
  const {
    nonDisableableRules: compareNonDisableableRules,
    ignoreWarnings: compareIgnoreWarnings,
    pragma: comparePragma,
    compareBranch: compareCompareBranch,
    monorepoConfig: compareMonorepoConfig,
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

  // Check that no new ignored packages have been added, if this is a monorepo
  if (!!currentMonorepoConfig !== !!compareMonorepoConfig) {
    validationErrors.push({
      message: `The config has been converted ${currentMonorepoConfig ? 'to' : 'from'} a monorepo config.`,
    });
  }
  if (currentMonorepoConfig && compareMonorepoConfig) {
    const excessPackages = currentMonorepoConfig.ignorePackagePaths.filter(
      (path) => !compareMonorepoConfig.ignorePackagePaths.includes(path)
    );
    if (excessPackages.length > 0) {
      validationErrors.push({
        message: `New ignored packages cannot be added to the config. New packages found: ${excessPackages
          .map((path) => getUnprefixedRelativeDir({ path, repoRootDir }))
          .join(', ')}`,
      });
    }
  }

  // If this is a monorepo, check each package config
  if (packageRootDirs?.length) {
    // First get the list of package configs from the compare branch
    const packageFilesToCheck = packageRootDirs.map((dir) =>
      join(dir, DEFAULT_CONFIG_FILE_NAME)
    );
    const lsTreeGitCommand = spawnSync(
      'git',
      [
        'ls-tree',
        '--name-only',
        resolvedCompareBranchName,
        '--',
        ...packageFilesToCheck,
      ],
      // stderr is inherited rather than piped so that, like gitShow below, a
      // git failure prints its own explanation to the user
      { cwd: repoRootDir, stdio: ['pipe', 'pipe', 'inherit'] }
    );
    if (lsTreeGitCommand.status !== 0) {
      error('Failed to get package config override paths from git');
      process.exit(1);
    }

    const comparePackageConfigOverridePaths = lsTreeGitCommand.stdout
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !!line)
      .map((line) => join(repoRootDir, line));

    // Now compare them to what's currently on disk. We don't need to check
    // config overrides that don't exist in the compare branch, since those are
    // by definition additive.
    for (const comparePackageConfigOverridePath of comparePackageConfigOverridePaths) {
      const compareConfigContent = gitShow({
        compareBranchName: resolvedCompareBranchName,
        path: comparePackageConfigOverridePath,
        repoRootDir,
      });
      const comparePackageConfigOverride = parsePackageConfigOverride({
        packageConfigOverrideFileContents: compareConfigContent,
      });

      // If there are no non-disableable rules in the compare branch, then we
      // don't need to do any checking and can bail early
      if (!comparePackageConfigOverride.nonDisableableRules?.length) {
        continue;
      }

      // Check if the config file is no longer present. Sometimes this is an
      // allowed use case, sometimes not
      if (!existsSync(comparePackageConfigOverridePath)) {
        validationErrors.push({
          message: `Package config override file ${getUnprefixedRelativeDir({
            path: comparePackageConfigOverridePath,
            repoRootDir,
          })} was deleted but it included non-disableable rules. Package config override files must not be deleted if they contain non-disableable rules`,
        });
      } else {
        const currentPackageConfigOverride = readPackageConfigOverride(
          comparePackageConfigOverridePath
        );
        const missingNonDisableableRules =
          comparePackageConfigOverride.nonDisableableRules.filter(
            (rule) =>
              !currentPackageConfigOverride.nonDisableableRules?.includes(rule)
          );
        if (missingNonDisableableRules.length) {
          validationErrors.push({
            message: `Package config override file ${getUnprefixedRelativeDir({
              path: comparePackageConfigOverridePath,
              repoRootDir,
            })} is missing non-disableable rules that were present in the compare branch: ${missingNonDisableableRules.join(', ')}`,
          });
        }
      }
    }
  }
}

function getCompareInfo({
  compareBranchName,
  configFilePath,
  repoRootDir,
}: {
  compareBranchName: string;
  configFilePath: string;
  repoRootDir: string;
}) {
  // Check if we need to use `compareBranch` or `origin/compareBranch`. In most
  // cases, we can use the branch directly. However in CI environments where
  // only the branch being tested is fetched, we need to use the origin branch.
  // That said, a repo recently created with `git init` won't yet have an
  // origin, so we need to handle that case too. There is no lowest common
  // denominator approach to use, so we try and infer.
  try {
    execSync(`git rev-parse --verify --quiet ${compareBranchName}`, {
      encoding: 'utf-8',
      cwd: repoRootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // The branch doesn't resolve as a local ref, so fall back to the
    // remote-tracking branch (the CI single-branch-checkout case).
    compareBranchName = `origin/${compareBranchName}`;
  }

  // Read in the config from the compare branch
  const compareConfigContent = gitShow({
    compareBranchName,
    path: configFilePath,
    repoRootDir,
  });
  const compareConfig = parseConfig({
    configFilePath,
    configFileContents: compareConfigContent,
  });

  // Read in the database from the compare branch, using the compare config
  // to track potential renames of the database file
  const compareDatabaseContent = gitShow({
    compareBranchName,
    path: compareConfig.databaseFile,
    repoRootDir,
  });
  const compareDatabase = createDatabase({
    filePath: undefined,
    databaseContents: JSON.parse(compareDatabaseContent) as unknown,
  });

  return {
    compareDatabase,
    compareConfig,
    resolvedCompareBranchName: compareBranchName,
  };
}

function gitShow({
  compareBranchName,
  path,
  repoRootDir,
}: {
  compareBranchName: string;
  path: string;
  repoRootDir: string;
}) {
  return execSync(
    `git show ${compareBranchName}:${getUnprefixedRelativeDir({ path, repoRootDir })}`,
    {
      encoding: 'utf-8',
      cwd: repoRootDir,
      // We don't hide output here though, so that if this really and truly
      // fails, users still get an error message
    }
  );
}
