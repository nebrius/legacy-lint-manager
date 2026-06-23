import { readFileSync, writeFileSync } from 'node:fs';

import type { LineContext, LintErrors } from '../types.js';
import { getFileComments } from '../util/comments.js';
import { InternalError } from '../util/error.js';
import { getFileContexts } from './getFileContexts.js';

export function addLegacyStatements({
  pragma,
  lintErrors,
}: {
  pragma: string;
  lintErrors: LintErrors;
}) {
  for (const [filePath, fileErrors] of lintErrors.errors) {
    // Get comments so we can check if we need to add to an existing disable
    const fileContents = readFileSync(filePath, 'utf-8');
    const fileContentsByLine = fileContents.split('\n');
    const {
      comments: fileComments,
      program,
      lineStartMapping,
    } = getFileComments({
      filePath,
      fileContents,
    });
    const lineContexts = getFileContexts(program, lineStartMapping);

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
        if (fileComment.endLine === line) {
          // Combine the existing disables with the new rules that need to be
          // disabled
          const combinedRules = Array.from(
            new Set([...fileComment.rules, ...rules])
          );
          // TODO: need to account for multiline comments
          fileContentsByLine[line - 1] = computeDisableComment({
            type: lintErrors.type,
            rules: combinedRules,
            pragma,
            line,
            lineContexts,
          });
          continue outer;
        }
      }
      // If we got here, this is a net new disable comment
      fileContentsByLine.splice(
        line,
        0,
        computeDisableComment({
          type: lintErrors.type,
          rules,
          pragma,
          line,
          lineContexts,
        })
      );
    }

    // Save the file
    writeFileSync(filePath, fileContentsByLine.join('\n'));
  }
}

function computeDisableComment({
  type,
  rules,
  pragma,
  line,
  lineContexts,
}: {
  type: 'eslint' | 'oxlint';
  rules: string[];
  pragma: string;
  line: number;
  lineContexts: LineContext[];
}) {
  const context = lineContexts[line] as LineContext | undefined;
  if (!context) {
    throw new InternalError('Line context not found');
  }
  const innerComment = `${type}-disable-next-line ${rules.join(', ')} -- ${pragma}`;
  if (context === 'jsx') {
    return `{/* ${innerComment} */}`;
  } else {
    return `// ${innerComment}`;
  }
}
