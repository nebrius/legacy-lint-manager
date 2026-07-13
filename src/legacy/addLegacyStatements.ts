import { getFileComments } from '../util/comments.js';
import { InternalError } from '../util/error.js';
import { error } from '../util/logging.js';
import { parseDisableComment } from '../util/parseDisableComment.js';
import { printValidationErrors } from '../util/printValidationErrors.js';
import type {
  LineContext,
  LintErrors,
  ValidationError,
} from '../util/types.js';
import { generateId } from './generateIds.js';
import { getFileContexts } from './getFileContexts.js';

export function addLegacyStatements({
  pragma,
  lintErrors,
  fileContents,
  filePath,
  repoRootDir,
}: {
  pragma: string;
  lintErrors: LintErrors;
  fileContents: string;
  filePath: string;
  repoRootDir: string;
}) {
  const fileContentsByLine = fileContents.split('\n');
  const validationErrors: ValidationError[] = [];
  const {
    comments: fileComments,
    program,
    lineStartMapping,
  } = getFileComments({
    filePath,
    fileContents,
    validationErrors,
  });

  if (validationErrors.length > 0) {
    printValidationErrors({ validationErrors, repoRootDir });
    error('Errors in this file will not be legacied');
    return undefined;
  }

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
        // comment, or if it's just a standard disable comment. We also ensure
        // that this isn't a malformed legacy comment, in which case stop, print
        // the error, and skip this file entirely
        const validationErrors: ValidationError[] = [];
        const parsedComment = parseDisableComment({
          comment: fileComment,
          pragma,

          // We don't care about validation errors here, since we're just
          // checking if this is a legacy comment or not
          validationErrors,
        });
        if (validationErrors.length > 0) {
          printValidationErrors({
            validationErrors,
            repoRootDir,
          });
          error('Errors in this file will not be legacied');
          return undefined;
        }

        let legaciedRules: string[];
        let nonLegaciedRules: string[];
        if (parsedComment?.type === 'legacy') {
          legaciedRules = Array.from(
            new Set([...rules, ...parsedComment.legaciedRules])
          );
          nonLegaciedRules = parsedComment.nonLegaciedRules;
        } else if (parsedComment?.type === 'nonlegacy') {
          legaciedRules = rules.filter(
            (rule) => !parsedComment.rules.includes(rule)
          );
          nonLegaciedRules = parsedComment.rules;
          /* v8 ignore start */
        } else {
          // TODO: At this point this should never happen, but it also means
          // we need to do a full validation before even starting legacying
          // so that we don't leave users in a broken state
          throw new InternalError(
            'Expected legacy or nonlegacy comment, got no comment at all'
          );
        }
        /* v8 ignore end */

        fileContentsByLine.splice(
          fileComment.startLine,
          fileComment.endLine - fileComment.startLine + 1,
          computeDisableComment({
            type: lintErrors.type,
            legaciedRules,
            nonLegaciedRules,
            pragma,
            line,
            lineContexts,
            indentation,
            id: generateId(
              parsedComment.type === 'legacy' ? parsedComment.id : undefined
            ),
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
        legaciedRules: rules,
        nonLegaciedRules: [],
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
  /* v8 ignore start */
  if (typeof indentation !== 'string') {
    throw new InternalError(`Could not compute indentation for ${line}`);
  }
  /* v8 ignore stop */
  return indentation;
}

function computeDisableComment({
  type,
  legaciedRules,
  nonLegaciedRules,
  pragma,
  line,
  lineContexts,
  indentation,
  id,
}: {
  type: 'eslint' | 'oxlint';
  legaciedRules: string[];
  nonLegaciedRules: string[];
  pragma: string;
  line: number;
  lineContexts: LineContext[];
  indentation: string;
  id: string;
}) {
  const combinedRules = Array.from(
    new Set([...legaciedRules, ...nonLegaciedRules])
  );
  const context = lineContexts[line] as LineContext | undefined;

  /* v8 ignore start */
  if (!context) {
    throw new InternalError('Line context not found');
  }
  /* v8 ignore stop */

  const innerComment = `${type}-disable-next-line ${combinedRules.join(', ')} -- ${pragma} (${legaciedRules.join(', ')}) ${id}`;
  if (context === 'jsx') {
    return `${indentation}{/* ${innerComment} */}`;
  } else {
    return `${indentation}// ${innerComment}`;
  }
}
