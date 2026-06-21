import { readFileSync } from 'node:fs';

import type {
  CommonOptions,
  LegacyComment,
  ValidationError,
} from '../types.js';
import { loadDatabase } from '../util/db.js';
import { getFileList } from '../util/files.js';
import { setVerbose, time } from '../util/logging.js';
import { getFileComments, parseDisableComment } from './comments.js';

export function validate(options: CommonOptions) {
  setVerbose(options.verbose);
  const database = loadDatabase(options.databaseFile);
  const files = time('Get file list', () => getFileList(options.rootDir));

  const legacyComments: LegacyComment[] = [];
  const validationErrors: ValidationError[] = [];
  time('Get file comments', () => {
    for (const file of files) {
      const comments = getFileComments({
        filePath: file,
        fileContents: readFileSync(file, 'utf-8'),
      });
      for (const comment of comments) {
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

  // Validate there are no duplicate IDs
  const ids = new Set<string>();
  for (const comment of legacyComments) {
    if (ids.has(comment.id)) {
      validationErrors.push({
        message: `Duplicate ID: ${comment.id}`,
        file: comment.file,
        line: comment.line,
      });
    }
    ids.add(comment.id);
  }

  console.log(legacyComments);
}
