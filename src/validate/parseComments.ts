import { readFileSync } from 'node:fs';

import { getFileComments } from '../util/comments.js';
import { parseDisableComment } from '../util/parseDisableComment.js';
import type {
  LegacyComment,
  NonLegacyComment,
  ValidationError,
} from '../util/types.js';

export function parseComments({
  files,
  nonDisableableRules,
  validationErrors,
  pragma,
  errorOnUnusedRules,
}: {
  files: string[];
  nonDisableableRules: string[];
  validationErrors: ValidationError[];
  pragma: string;
  errorOnUnusedRules: boolean;
}) {
  const legacyComments: LegacyComment[] = [];
  const nonLegacyComments: NonLegacyComment[] = [];
  for (const file of files) {
    const comments = getFileComments({
      filePath: file,
      fileContents: readFileSync(file, 'utf-8'),
      validationErrors,
    });
    for (const comment of comments.comments) {
      if (comment.disabledAll && nonDisableableRules.length > 0) {
        validationErrors.push({
          message:
            'Disabling all rules is not allowed because some rules are configured as non-disableable',
          location: {
            file,
            line: comment.startLine,
          },
        });
        continue;
      }
      const parsedDisableComment = parseDisableComment({
        comment,
        validationErrors,
        pragma,
        errorOnUnusedRules,
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

  return {
    legacyComments,
    nonLegacyComments,
  };
}
