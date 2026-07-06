import { dirname } from 'node:path';

import { readConfig } from '../util/config.js';
import { readDatabase } from '../util/db.js';
import { getFileList } from '../util/files.js';
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
  compare,
}: CommonOptions & {
  update: boolean;
  compare: boolean;
}) {
  setVerbose(verbose);

  const config = readConfig(configFilePath);
  const { pragma, databaseFile, nonDisableableRules } = config;
  const rootDir = dirname(configFilePath);
  const database = readDatabase(databaseFile);
  const files = time('getting file list', () => getFileList(rootDir));

  const validationErrors: ValidationError[] = [];
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

  if (compare) {
    time(`Comparing with the compare branch`, () => {
      compareWithBranch({
        currentDatabase: database,
        currentConfig: config,
        configFilePath,
        validationErrors,
      });
    });
  }

  const results = time('validating IDs', () =>
    validateDisableComments({
      nonDisableableRules,
      database,
      validationErrors,
      legacyComments,
      nonLegacyComments,
      linterType: config.linterType,
    })
  );

  // Print errors if any were found and exit with error code
  if (validationErrors.length > 0) {
    printValidationErrors({
      validationErrors,
      rootDir,
    });
    process.exit(1);
  }

  // Check if there were any unused IDs. Unused IDs are legacied errors listed
  // in the DB that couldn't be found in code, aka errors that were fixed
  if (results.wereErrorsFixed) {
    if (update) {
      info('Legacied lint errors were fixed, updating database...');
      database.setIds(results.ids);
      database.save();
    } else {
      error(
        'Legacied lint errors were fixed, good job! Run with --update to update the database.'
      );
      process.exit(1);
    }
  }
}
