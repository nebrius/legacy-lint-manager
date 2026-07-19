import { readFileSync, writeFileSync } from 'node:fs';

import type { LegacyComment } from '../util/types.js';

export function updateLegacyComments({
  legacyComments,
}: {
  legacyComments: LegacyComment[];
}) {
  const filesToUpdate = new Map<string, LegacyComment[]>();
  for (const comment of legacyComments) {
    if (comment.unusedLegaciedRules.length > 0) {
      if (!filesToUpdate.has(comment.file)) {
        filesToUpdate.set(comment.file, []);
      }
      filesToUpdate.get(comment.file)?.push(comment);
    }
  }
  for (const [filePath, comments] of filesToUpdate) {
    // Sort in reverse order so that we can iterate backwards and not shift
    // indices we haven't yet updated
    comments.sort((a, b) => b.startIndex - a.startIndex);
    let fileContents = readFileSync(filePath, 'utf-8');
    for (const comment of comments) {
      // Check if there are no longer any valid rules left in the legacy,
      // comment, which means we should remove the entire legacy comment (but
      // leave the rest of the disable comment)
      if (comment.legaciedRules.length === 0) {
        // Remove the entire comment
        fileContents =
          fileContents.slice(0, comment.descriptionStartIndex) +
          fileContents.slice(comment.endIndex);
      }
      // Otherwise, we need to leave the legacy comment in place and just prune
      // the list of rules
      else {
        fileContents =
          fileContents.slice(0, comment.legaciedRulesStartIndex) +
          `(${comment.legaciedRules.join(', ')})` +
          fileContents.slice(comment.legaciedRulesEndIndex);
      }
    }
    writeFileSync(filePath, fileContents, 'utf-8');
  }
}
