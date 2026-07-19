import { readFileSync, writeFileSync } from 'node:fs';

import type { LegacyComment } from '../util/types.js';

// A legacy comment needs updating when rules were pruned from its legacy list
// (aka their violations were fixed), or when no legacied rules remain at all
// (including a hand-emptied `()` list), in which case the entire legacy portion
// of the comment is removed
export function doesLegacyCommentNeedUpdate(comment: LegacyComment) {
  return (
    comment.unusedLegaciedRules.length > 0 || comment.legaciedRules.length === 0
  );
}

export function updateLegacyComments({
  legacyComments,
}: {
  legacyComments: LegacyComment[];
}) {
  const filesToUpdate = new Map<string, LegacyComment[]>();
  for (const comment of legacyComments) {
    if (doesLegacyCommentNeedUpdate(comment)) {
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
      // Check if there are no longer any valid rules left in the legacy
      // comment, which means we should remove the entire legacy comment (but
      // leave the rest of the disable comment)
      if (comment.legaciedRules.length === 0) {
        const beforeLegacy = fileContents.slice(
          0,
          comment.descriptionStartIndex
        );
        const afterComment = fileContents.slice(comment.endIndex);
        // In a block comment (e.g. JSX) the closing `*/` follows immediately,
        // and we keep the space in front of it. In a line comment we're at the
        // end of the line, so we strip the now-dangling whitespace before the
        // removed `--`
        fileContents = afterComment.startsWith('*/')
          ? beforeLegacy + afterComment
          : beforeLegacy.trimEnd() + afterComment;
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
