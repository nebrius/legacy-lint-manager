import { dirname } from 'node:path';

import { readConfig } from '../util/config.js';
import { readDatabase } from '../util/db.js';
import { getFileList } from '../util/files.js';
import { error, info, setVerbose, time } from '../util/logging.js';
import { printValidationErrors } from '../util/printValidationErrors.js';
import type { CommonOptions, ValidationError } from '../util/types.js';
import type { CompareInfo } from './getCompareInfo.js';
import { getCompareInfo } from './getCompareInfo.js';
import { parseComments } from './parseComments.js';
import { validateDisableComments } from './validateDisableComments.js';

export function validate({
  verbose,
  config,
  update,
  compare,
}: CommonOptions & {
  update: boolean;
  compare: boolean;
}) {
  setVerbose(verbose);

  const { pragma, databaseFile, compareBranch, nonDisableableRules } =
    readConfig(config);
  const rootDir = dirname(config);
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

  // Get the list of expected IDs, if comparing against a branch is enabled
  let compareData: CompareInfo | undefined;
  // Note: since compare reads a file from another branch, it can't be easily
  // tested in unit tests. There is an integration test at
  // src/__tests__/integration/getCompareInfo.integration.test.ts that exercises
  // this code path, but code coverage doesn't work on integration tests
  /* v8 ignore start */
  if (compare) {
    time('Getting list of expected IDs from compare branch', () => {
      compareData = getCompareInfo({
        compareBranch,
        databaseFile,
      });
    });
  }
  /* v8 ignore end */

  const results = time('validating IDs', () =>
    validateDisableComments({
      nonDisableableRules,
      database,
      validationErrors,
      legacyComments,
      nonLegacyComments,
      compareData,
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
