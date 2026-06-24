import { readFileSync, writeFileSync } from 'node:fs';

import { nanoid } from 'nanoid';

import type { LineContext, LintErrors } from '../types.js';
import { getFileComments } from '../util/comments.js';
import { InternalError } from '../util/error.js';
import { parseDisableComment } from '../validate/parseDisableComment.js';
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
        if (
          fileComment.endLine === line - 1 &&
          // Make sure this is a disable-next-line comment, because those are
          // the only type of comments that a) can be a legacy comment (and thus
          // need to be merged) and b) must live immediately before the line
          // they disable. Block comments and same-line comments can coexist
          // with separate legacy disable blocks, so we don't need to merge them
          fileComment.type === 'next-line'
        ) {
          // Parse the comment to see if this is a previously existing legacy
          // comment, or if it's just a standard disable comment
          const parsedComment = parseDisableComment({
            comment: fileComment,
            pragma,

            // We don't care about validation errors here, since we're just
            // checking if this is a legacy comment or not
            validationErrors: [],
          });
          fileContentsByLine.splice(
            fileComment.startLine,
            fileComment.endLine - fileComment.startLine + 1,
            computeDisableComment({
              type: lintErrors.type,
              existingRules: fileComment.rules,
              newRules: rules,
              pragma,
              line,
              lineContexts,

              // TODO: need to figure out a way to detect global collisions
              id: generateId(parsedComment?.id),
            })
          );
          continue outer;
        }
      }
      // If we got here, this is a net new disable comment
      fileContentsByLine.splice(
        line,
        0,
        computeDisableComment({
          type: lintErrors.type,
          existingRules: [],
          newRules: rules,
          pragma,
          line,
          lineContexts,
          id: generateId(),
        })
      );
    }

    // Save the file
    writeFileSync(filePath, fileContentsByLine.join('\n'));
  }
}

// It is very unlikely that we'll ever have a collision, but given that
// collisions are fatal, we store all generated IDs in a set to prevent them.
const idSet = new Set<string>();
function generateId(previousId?: string) {
  let id = previousId ?? nanoid(8);

  /* v8 ignore start */
  while (idSet.has(id)) {
    id = nanoid(8);
  }
  /* v8 ignore stop */

  idSet.add(id);
  return id;
}

function computeDisableComment({
  type,
  existingRules,
  newRules,
  pragma,
  line,
  lineContexts,
  id,
}: {
  type: 'eslint' | 'oxlint';
  existingRules: string[];
  newRules: string[];
  pragma: string;
  line: number;
  lineContexts: LineContext[];
  id: string;
}) {
  const combinedRules = Array.from(new Set([...existingRules, ...newRules]));
  const context = lineContexts[line] as LineContext | undefined;
  if (!context) {
    throw new InternalError('Line context not found');
  }
  const innerComment = `${type}-disable-next-line ${combinedRules.join(', ')} -- ${pragma} (${newRules.join(', ')}) ${id}`;
  if (context === 'jsx') {
    return `{/* ${innerComment} */}`;
  } else {
    return `// ${innerComment}`;
  }
}
