import { isAbsolute, resolve } from 'node:path';

import type { Config } from '../util/config.js';
import { readConfig } from '../util/config.js';
import { readDatabase } from '../util/db.js';
import { getFileList, getRepoRoot } from '../util/files.js';
import { getPackageRootDirs } from '../util/getPackageRootDirs.js';
import { error, info, setVerbose, time } from '../util/logging.js';
import { printValidationErrors } from '../util/printValidationErrors.js';
import type { CommonOptions, ValidationError } from '../util/types.js';
import { compareWithBranch } from './compareWithBranch.js';
import { parseComments } from './parseComments.js';
import { validateDisableComments } from './validateDisableComments.js';

export function validate({
  verbose,
  config: configFilePath,
  update,
}: CommonOptions & {
  update: boolean;
}) {
  setVerbose(verbose);
  if (!isAbsolute(configFilePath)) {
    configFilePath = resolve(process.cwd(), configFilePath);
  }

  const config = readConfig(configFilePath);
  const repoRootDir = getRepoRoot(configFilePath);
  const database = readDatabase(config.databaseFile);
  const validationErrors: ValidationError[] = [];

  // Create the map form of the database that maps from id in the database to
  // whether or not it was found in the code.
  const databaseMap = new Map<
    string,
    { foundInCode: boolean; rules: string[] }
  >();
  for (const [id, rules] of database.getIds()) {
    databaseMap.set(id, { foundInCode: false, rules });
  }

  time(`Comparing with the compare branch`, () => {
    compareWithBranch({
      currentDatabase: database,
      currentConfig: config,
      configFilePath,
      validationErrors,
      repoRootDir,
    });
  });

  if (config.monorepoConfig) {
    const packageRootDirs = getPackageRootDirs({
      repoRootDir,
      monorepoConfig: config.monorepoConfig,
      validationErrors,
    });
    for (const packageRootDir of packageRootDirs) {
      validatePackage({
        config,
        packageRootDir,
        databaseMap,
        validationErrors,
      });
    }
  } else {
    validatePackage({
      config,
      packageRootDir: repoRootDir,
      databaseMap,
      validationErrors,
    });
  }

  // Print errors if any were found and exit with error code
  if (validationErrors.length > 0) {
    printValidationErrors({
      validationErrors,
      repoRootDir,
    });
    process.exit(1);
  }

  // Check if there were any unused IDs. Unused IDs are legacied errors listed
  // in the DB that couldn't be found in code, aka errors that were fixed
  const wereErrorsFixed = Array.from(databaseMap.values()).some(
    ({ foundInCode }) => !foundInCode
  );
  if (wereErrorsFixed) {
    if (update) {
      info('Legacied lint errors were fixed, updating database...');
      const currentIds = new Map<string, string[]>();
      for (const [id, { rules, foundInCode }] of databaseMap.entries()) {
        if (foundInCode) {
          currentIds.set(id, rules);
        }
      }
      database.setIds(currentIds);
      database.save();
    } else {
      error(
        'Legacied lint errors were fixed, good job! Run with --update to update the database.'
      );
      process.exit(1);
    }
  }
}

function validatePackage({
  config,
  packageRootDir,
  databaseMap,
  validationErrors,
}: {
  config: Config;
  packageRootDir: string;
  databaseMap: Map<string, { foundInCode: boolean; rules: string[] }>;
  validationErrors: ValidationError[];
}) {
  const { pragma, nonDisableableRules } = config;
  const files = time('getting file list', () => getFileList(packageRootDir));

  const { legacyComments, nonLegacyComments } = time(
    'getting file comments',
    () =>
      parseComments({
        files,
        nonDisableableRules,
        validationErrors,
        pragma,
      })
  );

  time('validating IDs', () => {
    validateDisableComments({
      nonDisableableRules,
      validationErrors,
      legacyComments,
      nonLegacyComments,
      linterType: config.linterType,
      databaseMap,
    });
  });
}
