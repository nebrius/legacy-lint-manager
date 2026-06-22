import { parseSync } from 'oxc-parser';

import type { Comment, LegacyComment, ValidationError } from '../types.js';

// Note: these entries MUST be specified from longest to shortest
// to ensure proper prefix matching. If not, we might only strip out
// "eslint-disable" when we actually need to strip "eslint-disable-next-line".
const DISABLE_PREFIXES = [
  'eslint-disable-next-line',
  'eslint-disable-line',
  'eslint-disable',
  'oxlint-disable-next-line',
  'oxlint-disable-line',
  'oxlint-disable',
];

export function getFileComments({
  filePath,
  fileContents,
}: {
  filePath: string;
  fileContents: string;
}) {
  const { comments, program } = parseSync(filePath, fileContents);
  const commentsList: Comment[] = [];
  for (const comment of comments) {
    const parsedComment = parseCommentText(
      comment.value.trim().replaceAll('\n', ' ')
    );
    if (parsedComment) {
      commentsList.push({
        ...parsedComment,
        file: filePath,
        line: fileContents.slice(0, comment.end).split('\n').length,
      });
    }
  }
  return { comments: commentsList, program };
}

function parseCommentText(
  text: string
): Omit<Comment, 'file' | 'line'> | undefined {
  // Strip out the disable prefix, if this comment is indeed a disable comment
  let prefixFound = false;
  for (const prefix of DISABLE_PREFIXES) {
    if (text.startsWith(prefix)) {
      const strippedText = text.substring(prefix.length);

      // We have to make sure that the first character in the remaining test is
      // a whitespace character or the string is empty (representing disabling
      // all rules), otherwise it's not a real disable comment
      if (strippedText.match(/^\s/) || strippedText.length === 0) {
        text = strippedText.trim();
        prefixFound = true;
        break;
      }
    }
  }

  // If no disable prefix was found, this isn't a valid ESLint/Oxlint comment
  if (!prefixFound) {
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
  const rules = commentParts[0]
    .split(',')
    .map((rule) => rule.trim())
    // In the case of a disable without a specific list of rules (aka disable
    // all), the rules array will contain a single empty string that we need to
    // filter out here
    .filter((rule) => rule.length > 0);
  const comment = commentParts[1]?.trim();

  return { rules, disabledAll: rules.length === 0, comment };
}

export function parseDisableComment({
  comment,
  pragma,
  validationErrors,
}: {
  comment: Comment;
  pragma: string;
  validationErrors: ValidationError[];
}): LegacyComment | undefined {
  // If this is a regular ESLint/Oxlint disable comment and not a legacy pragma,
  // then ignore it.
  if (!comment.comment?.startsWith(pragma)) {
    return undefined;
  }

  // Since legacy comments are generated, we can be strict about whitespace
  const parts = new RegExp(`^${pragma} \\((.*)\\) ([a-zA-Z0-9]{8})$`);
  const match = comment.comment.match(parts);
  if (!match) {
    validationErrors.push({
      message: `Malformed legacy comment: ${comment.comment}`,
      file: comment.file,
      line: comment.line,
    });
    return undefined;
  }

  const rules = match[1].split(',').map((rule) => rule.trim());
  const id = match[2];

  return {
    file: comment.file,
    line: comment.line,
    rules,
    id,
  };
}
