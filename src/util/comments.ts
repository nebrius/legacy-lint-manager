import type { Comment as OxcComment } from 'oxc-parser';
import { parseSync } from 'oxc-parser';

import { commaSeparatedStringToArray } from './string.js';
import type { Comment, ValidationError } from './types.js';

// Note: these entries MUST be specified from longest to shortest
// to ensure proper prefix matching. If not, we might only strip out
// "eslint-disable" when we actually need to strip "eslint-disable-next-line".
const DISABLE_PREFIXES: [string, Comment['type']][] = [
  ['eslint-disable-next-line', 'next-line'],
  ['eslint-disable-line', 'same-line'],
  ['eslint-disable', 'block'],
  ['oxlint-disable-next-line', 'next-line'],
  ['oxlint-disable-line', 'same-line'],
  ['oxlint-disable', 'block'],
];

export function getFileComments({
  filePath,
  fileContents,
  validationErrors,
}: {
  filePath: string;
  fileContents: string;
  validationErrors: ValidationError[];
}) {
  const { comments, program, errors } = parseSync(filePath, fileContents);

  // Compute a mapping of line number (0-indexed) to file offsets
  const lineStartMapping = [0]; // line 0 always maps to position 0
  for (let i = 0; i < fileContents.length; i++) {
    if (fileContents[i] === '\n') {
      lineStartMapping.push(i + 1);
    }
  }

  // If there were any errors, report them here. Note: we have to wait until
  // after we've computed line start mappings so that we can convert
  // error positions to line numbers.
  if (errors.length > 0) {
    for (const error of errors) {
      const errorStart = error.labels.at(0)?.start;
      validationErrors.push({
        message: `Errors parsing file: ${error.message}`,
        location:
          errorStart !== undefined
            ? {
                file: filePath,
                line: getLineFromIndex({
                  index: errorStart,
                  lineStartMapping,
                }),
              }
            : undefined,
      });
    }
  }

  const commentsList: Comment[] = [];
  for (const rawComment of comments) {
    const parsedComment = parseCommentText({
      filePath,
      rawComment,
      validationErrors,
      lineStartMapping,
    });
    if (parsedComment) {
      commentsList.push(parsedComment);
    }
  }
  return { comments: commentsList, program, lineStartMapping };
}

function parseCommentText({
  filePath,
  rawComment,
  validationErrors,
  lineStartMapping,
}: {
  filePath: string;
  lineStartMapping: number[];
  rawComment: OxcComment;
  validationErrors: ValidationError[];
}): Comment | undefined {
  let text: string = rawComment.value.trim().replaceAll('\n', ' ');

  // Check if this is an ESLint configuration line that has the shape:
  // `/* eslint "example/rule1": "error" */`
  //
  // These are very rarely used, and almost entirely in very old code dating to
  // the early days of ESLint. So instead of trying to parse them (which is very
  // complicated, and ESLint's own implementation is partially broken), we just
  // report them as an outright error and force the user to remove it.
  if (text.match(/^eslint\s/) && rawComment.type === 'Block') {
    validationErrors.push({
      message: 'ESLint configuration comments are not supported',
      location: {
        file: filePath,
        line: getLineFromIndex({
          index: rawComment.start,
          lineStartMapping,
        }),
      },
    });
    return undefined;
  }

  // Strip out the disable prefix, if this comment is indeed a disable comment
  let prefixType: Comment['type'] | undefined;
  for (const [prefix, type] of DISABLE_PREFIXES) {
    if (text.startsWith(prefix)) {
      // First check if this is an ESLint comment, which restricts which types
      // of prefixes are valid in certain comment types, and otherwise ignores
      // them, so we duplicate that logic here
      if (prefix.startsWith('eslint')) {
        if (type === 'block' && rawComment.type !== 'Block') {
          continue;
        }
      }
      const strippedText = text.substring(prefix.length);

      // We have to make sure that the first character in the remaining text is
      // a whitespace character or the string is empty (representing disabling
      // all rules), otherwise it's not a real disable comment
      if (strippedText.match(/^\s/) || strippedText.length === 0) {
        text = strippedText.trim();
        prefixType = type;
        break;
      }
    }
  }

  // If no disable prefix was found, this isn't a valid ESLint/Oxlint comment
  if (!prefixType) {
    return undefined;
  }

  // Split the comment into rules and optional comment. If a comment has a
  // second '--' after the first comment separator, then that second one is part
  // of the comment and not a second separator.
  const commentIndex = text.indexOf('--');
  const commentParts =
    commentIndex !== -1
      ? [text.slice(0, commentIndex), text.slice(commentIndex + 2)]
      : [text];
  const rules = commaSeparatedStringToArray(commentParts[0]);
  const comment = commentParts[1]?.trim();

  const legacyIndex = rawComment.value.indexOf('--');

  return {
    type: prefixType,
    rules,
    descriptionStartIndex:
      legacyIndex !== -1 ? rawComment.start + legacyIndex + 2 : undefined,
    disabledAll: rules.length === 0,
    comment,
    file: filePath,
    startLine: getLineFromIndex({
      index: rawComment.start,
      lineStartMapping,
    }),
    startIndex: rawComment.start + 2,
    endLine: getLineFromIndex({
      index: rawComment.end,
      lineStartMapping,
    }),
    endIndex: rawComment.end - (rawComment.type === 'Block' ? 2 : 0),
  };
}

export function getLineFromIndex({
  index,
  lineStartMapping,
}: {
  index: number;
  lineStartMapping: number[];
}) {
  let line = 0;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    if (
      // Check if this index is between this line and the next, or is the last line
      (lineStartMapping[line] <= index && lineStartMapping[line + 1] > index) ||
      !Object.prototype.hasOwnProperty.call(lineStartMapping, line + 1)
    ) {
      break;
    }
    line++;
  }
  return line;
}
