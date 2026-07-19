import { isAbsolute, resolve } from 'node:path';

import type { Config } from '../util/config.js';
import { getPackageSpecificConfig, readConfig } from '../util/config.js';
import { AI_SKILL_HINT, UPDATE_COMMAND } from '../util/constants.js';
import { readDatabase } from '../util/db.js';
import { getFileList, getRepoRoot } from '../util/files.js';
import { getPackageRootDirs } from '../util/getPackageRootDirs.js';
import { error, info, setVerbose, time } from '../util/logging.js';
import { printValidationErrors } from '../util/printValidationErrors.js';
import type {
  CommonOptions,
  LegacyComment,
  ValidationError,
} from '../util/types.js';
import { compareWithBranch } from './compareWithBranch.js';
import { parseComments } from './parseComments.js';
import {
  doesLegacyCommentNeedUpdate,
  updateLegacyComments,
} from './updateLegacyComments.js';
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

  const packageRootDirs = config.monorepoConfig
    ? getPackageRootDirs({
        repoRootDir,
        monorepoConfig: config.monorepoConfig,
        validationErrors,
      })
    : undefined;

  time(`Comparing with the compare branch`, () => {
    compareWithBranch({
      currentDatabase: database,
      currentConfig: config,
      configFilePath,
      validationErrors,
      repoRootDir,
      packageRootDirs,
    });
  });

  const legacyComments: LegacyComment[] = [];
  if (packageRootDirs) {
    for (const packageRootDir of packageRootDirs) {
      const packageSpecificConfig = getPackageSpecificConfig({
        packageRootDir,
        config,
      });
      legacyComments.push(
        ...validatePackage({
          config: packageSpecificConfig,
          packageRootDir,
          databaseMap,
          validationErrors,
          errorOnUnusedRules: !update,
        })
      );
    }
  } else {
    legacyComments.push(
      ...validatePackage({
        config,
        packageRootDir: repoRootDir,
        databaseMap,
        validationErrors,
        errorOnUnusedRules: !update,
      })
    );
  }

  // Print errors if any were found and exit with error code
  if (validationErrors.length > 0) {
    printValidationErrors({
      validationErrors,
      repoRootDir,
    });
    exitWithValidationFailure();
  }

  // Check if there were any unused IDs. Unused IDs are legacied errors listed
  // in the DB that couldn't be found in code, aka errors that were fixed
  const wereErrorsFixed = Array.from(databaseMap.values()).some(
    ({ foundInCode }) => !foundInCode
  );
  const doLegacyStatementsNeedPruning = legacyComments.some(
    doesLegacyCommentNeedUpdate
  );
  if (update) {
    if (doLegacyStatementsNeedPruning || wereErrorsFixed) {
      info(
        'Legacied lint errors were fixed, updating legacy statements and database...'
      );
      updateLegacyComments({ legacyComments });
      // We need to reconcile carefully here. Since we may have pruned legacy
      // comments, we have to make sure we get the latest versions.
      const keptRulesById = new Map(
        legacyComments.map((comment): [string, string[]] => [
          comment.id,
          comment.legaciedRules,
        ])
      );
      const currentIds = new Map<string, string[]>();
      for (const id of databaseMap.keys()) {
        const keptRules = keptRulesById.get(id);
        if (keptRules?.length) {
          currentIds.set(id, keptRules);
        }
      }
      database.setIds(currentIds);
      database.save();
    }
  } else if (wereErrorsFixed) {
    error(
      `Legacied lint errors were fixed, good job! Run \`${UPDATE_COMMAND}\` to update the database.`
    );
    exitWithValidationFailure();
  }
}

// The AI hint is only printed for validate failures, not legacy-errors/init
// failures, because the skill it points to only covers validation. See the
// AI agent skill section in the README for more information.
function exitWithValidationFailure(): never {
  error(AI_SKILL_HINT);
  process.exit(1);
}

function validatePackage({
  config,
  packageRootDir,
  databaseMap,
  validationErrors,
  errorOnUnusedRules,
}: {
  config: Config;
  packageRootDir: string;
  databaseMap: Map<string, { foundInCode: boolean; rules: string[] }>;
  validationErrors: ValidationError[];
  errorOnUnusedRules: boolean;
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
        errorOnUnusedRules,
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

  return legacyComments;
}
