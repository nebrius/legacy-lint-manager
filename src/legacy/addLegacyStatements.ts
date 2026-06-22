import { readFileSync, writeFileSync } from 'node:fs';

import type { LintErrors } from '../types.js';
import { getFileComments } from '../util/comments.js';

export function addLegacyStatements(lintErrors: LintErrors) {
  for (const [filePath, fileErrors] of lintErrors) {
    // Get comments so we can check if we need to add to an existing disable
    const fileContents = readFileSync(filePath, 'utf-8');
    const fileContentsByLine = fileContents.split('\n');
    const fileComments = getFileComments({
      filePath,
      fileContents,
    });

    // Sort lines in reverse order so we can reverse iterate over the file
    const sortedFileErrors = Array.from(fileErrors.entries()).sort(
      ([a], [b]) => b - a
    );

    // Add the legacy comment to the file, iterating in reverse order so that
    // future lines to disable are not displaced
    outer: for (const [line, rules] of sortedFileErrors) {
      // First, check if there is already a disable comment for this line, in
      // which case we need to replace it.
      for (const fileComment of fileComments) {
        // Note: file comment lines are 1-indexed, so we actually do want to
        // compare lines directly, even though conceptually we're comparing
        // with the line before.
        if (fileComment.line === line) {
          // Combine the existing disables with the new rules that need to be
          // disabled
          const combinedRules = Array.from(
            new Set([...fileComment.rules, ...rules])
          );
          fileContentsByLine[line - 1] =
            `// eslint-disable-next-line ${combinedRules.join(', ')}`;
          continue outer;
        }
      }
      // If we got here, this is a net new disable comment
      fileContentsByLine.splice(
        line,
        0,
        `// eslint-disable-next-line ${rules.join(', ')}`
      );
    }

    // Save the file
    writeFileSync(filePath, fileContentsByLine.join('\n'));
  }
}
