import { readFileSync } from 'node:fs';
import { dirname, sep } from 'node:path';

import { getFileComments } from '../util/comments.js';
import { readConfig } from '../util/config.js';
import { readDatabase } from '../util/db.js';
import { getFileList } from '../util/files.js';
import { error, info, setVerbose, time } from '../util/logging.js';
import type {
  CommonOptions,
  LegacyComment,
  NonLegacyComment,
  ValidationError,
} from '../util/types.js';
import type { CompareInfo } from './getCompareInfo.js';
import { getCompareInfo } from './getCompareInfo.js';
import { parseDisableComment } from './parseDisableComment.js';
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

  const legacyComments: LegacyComment[] = [];
  const nonLegacyComments: NonLegacyComment[] = [];
  const validationErrors: ValidationError[] = [];
  time('getting file comments', () => {
    for (const file of files) {
      const comments = getFileComments({
        filePath: file,
        fileContents: readFileSync(file, 'utf-8'),
      });
      for (const comment of comments.comments) {
        const parsedDisableComment = parseDisableComment({
          comment,
          validationErrors,
          pragma,
        });
        if (parsedDisableComment) {
          if (parsedDisableComment.type === 'legacy') {
            legacyComments.push(parsedDisableComment);
          } else {
            nonLegacyComments.push(parsedDisableComment);
          }
        }
      }
    }
  });

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

  // Print errors if any were found
  if (validationErrors.length > 0) {
    const groupedErrors = new Map<string, ValidationError[]>();
    for (const validationError of validationErrors) {
      if (validationError.location) {
        if (!groupedErrors.has(validationError.location.file)) {
          groupedErrors.set(validationError.location.file, []);
        }
        groupedErrors.get(validationError.location.file)?.push(validationError);
      } else {
        if (!groupedErrors.has('Global')) {
          groupedErrors.set('Global', []);
        }
        groupedErrors.get('Global')?.push(validationError);
      }
    }
    for (const [file, errors] of groupedErrors) {
      error(`${file.replace(rootDir + sep, '')}:`);
      for (const err of errors) {
        error(
          `  ${err.location?.line ? `${err.location.line.toString()}: ` : ''}${err.message}`
        );
      }
    }
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
