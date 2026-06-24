// eslint-disable-next-line simple-import-sort/imports
import { readFileSync } from 'node:fs';

import type {
  CommonOptions,
  LegacyComment,
  ValidationError,
} from '../types.js';
import { Database } from '../util/db.js';
import { getFileList } from '../util/files.js';
import { error, info, setVerbose, time } from '../util/logging.js';
import { getFileComments } from '../util/comments.js';
import { validateIds } from './validateIds.js';
import { parseDisableComment } from './parseDisableComment.js';

export function validate(options: CommonOptions & { update: boolean }) {
  setVerbose(options.verbose);
  const database = new Database(options.databaseFile);
  const files = time('Getting file list', () => getFileList(options.rootDir));

  const legacyComments: LegacyComment[] = [];
  const validationErrors: ValidationError[] = [];
  time('Getting file comments', () => {
    for (const file of files) {
      const comments = getFileComments({
        filePath: file,
        fileContents: readFileSync(file, 'utf-8'),
      });
      for (const comment of comments.comments) {
        const parsedDisableComment = parseDisableComment({
          comment,
          validationErrors,
          pragma: options.pragma,
        });
        if (parsedDisableComment) {
          legacyComments.push(parsedDisableComment);
        }
      }
    }
  });

  const results = time('Validating IDs', () =>
    validateIds({
      database,
      validationErrors,
      legacyComments,
    })
  );

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
    if (options.update) {
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
