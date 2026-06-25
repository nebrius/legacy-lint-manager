import type { LineContext, LintErrors } from '../types.js';
import { getFileComments } from '../util/comments.js';
import { InternalError } from '../util/error.js';
import { parseDisableComment } from '../validate/parseDisableComment.js';
import { generateId } from './generateIds.js';
import { getFileContexts } from './getFileContexts.js';

export function addLegacyStatements({
  pragma,
  lintErrors,
  fileContents,
  filePath,
}: {
  pragma: string;
  lintErrors: LintErrors;
  fileContents: string;
  filePath: string;
}) {
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
  const fileErrors = lintErrors.errors.get(filePath);

  /* v8 ignore start */
  if (!fileErrors) {
    throw new InternalError(`No errors found for file ${filePath}`);
  }
  /* v8 ignore stop */

  // Sort lines in reverse order so we can reverse iterate over the file
  const sortedFileErrors = Array.from(fileErrors.entries()).sort(
    ([a], [b]) => b - a
  );

  // Add the legacy comment to the file, iterating in forward order of the
  // reverse sorted array so that lines don't get offset by other fixes
  outer: for (const [line, rules] of sortedFileErrors) {
    const indentation = getIndentation(fileContentsByLine[line]);
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
            indentation,
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
        indentation,
        id: generateId(),
      })
    );
  }

  return fileContentsByLine.join('\n');
}

function getIndentation(line: string) {
  const indentation = line.match(/^\s*/)?.[0];
  if (typeof indentation !== 'string') {
    throw new InternalError(`Could not compute indentation for ${line}`);
  }
  return indentation;
}

function computeDisableComment({
  type,
  existingRules,
  newRules,
  pragma,
  line,
  lineContexts,
  indentation,
  id,
}: {
  type: 'eslint' | 'oxlint';
  existingRules: string[];
  newRules: string[];
  pragma: string;
  line: number;
  lineContexts: LineContext[];
  indentation: string;
  id: string;
}) {
  const combinedRules = Array.from(new Set([...existingRules, ...newRules]));
  const context = lineContexts[line] as LineContext | undefined;

  /* v8 ignore start */
  if (!context) {
    throw new InternalError('Line context not found');
  }
  /* v8 ignore stop */

  const innerComment = `${type}-disable-next-line ${combinedRules.join(', ')} -- ${pragma} (${newRules.join(', ')}) ${id}`;
  if (context === 'jsx') {
    return `${indentation}{/* ${innerComment} */}`;
  } else {
    return `${indentation}// ${innerComment}`;
  }
}
