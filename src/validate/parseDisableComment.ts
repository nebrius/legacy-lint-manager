import type { Comment, LegacyComment, ValidationError } from '../types.js';

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
  const parts = new RegExp(`^${pragma} \\((.*)\\) ([a-zA-Z0-9_-]{8})$`);
  const match = comment.comment.match(parts);
  if (!match) {
    validationErrors.push({
      message: `Malformed legacy comment: ${comment.comment}`,
      file: comment.file,
      line: comment.startLine,
    });
    return undefined;
  }

  const rules = match[1].split(',').map((rule) => rule.trim());
  const id = match[2];

  return {
    file: comment.file,
    startLine: comment.startLine,
    endLine: comment.endLine,
    rules,
    id,
  };
}
