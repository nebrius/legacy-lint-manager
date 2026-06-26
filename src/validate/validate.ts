import { readFileSync } from 'node:fs';

import type {
  CommonOptions,
  LegacyComment,
  ValidationError,
} from '../types.js';
import { getFileComments } from '../util/comments.js';
import { fromFile } from '../util/db.js';
import { getFileList } from '../util/files.js';
import { error, info, setVerbose, time } from '../util/logging.js';
import type { CompareInfo } from './getCompareInfo.js';
import { getCompareInfo } from './getCompareInfo.js';
import { parseDisableComment } from './parseDisableComment.js';
import { validateIds } from './validateIds.js';

export function validate({
  verbose,
  databaseFile,
  pragma,
  rootDir,
  update,
  compareBranch,
  compare,
}: CommonOptions & {
  update: boolean;
  compareBranch: string | undefined;
  compare: boolean;
}) {
  setVerbose(verbose);
  const database = fromFile({
    databaseFile,
    createIfMissing: false,
  });
  const files = time('getting file list', () => getFileList(rootDir));

  const legacyComments: LegacyComment[] = [];
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
          legacyComments.push(parsedDisableComment);
        }
      }
    }
  });

  // Get the list of expected IDs, if comparing against a branch is enabled
  let compareData: CompareInfo | undefined;
  if (compare) {
    // Note: due to the nature of compare (reading a file across branches), we
    // can't easily write a unit test for this code path. There is an
    // integration test at src/__tests__/integration/getCompareInfo.integration.test.ts
    // that exercises this code path, but code coverage can't track it due
    // to the use of a subprocess used to call the CLI.
    /* v8 ignore start */
    time('Getting list of expected IDs from compare branch', () => {
      compareData = getCompareInfo({
        compareBranch,
        databaseFile,
      });
    });
    /* v8 ignore end */
  }

  const results = time('validating IDs', () =>
    validateIds({
      database,
      validationErrors,
      legacyComments,
      compareData,
    })
  );

  // Print errors if any were found
  if (validationErrors.length > 0) {
    error('Validation errors:');
    for (const validationError of validationErrors) {
      error(`${validationError.file}:${validationError.line.toString()}`);
      error(`  ${validationError.message}`);
    }
    process.exit(1);
  }

  // Check if there were any unused IDs. Unused IDs are legacied errors listed
  // in the DB that couldn't be found in code, aka errors that were fixed
  if (results.unusedIds.length > 0) {
    if (update) {
      info('Legacied lint errors were fixed, updating database...');
      database.setIds(results.usedIds.sort());
      database.save();
    } else {
      error(
        'Legacied lint errors were fixed, good job! Run with --update to update the database.'
      );
      process.exit(1);
    }
  }
}
