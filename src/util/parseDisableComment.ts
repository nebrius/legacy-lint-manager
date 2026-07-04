import type {
  Comment,
  LegacyComment,
  NonLegacyComment,
  ValidationError,
} from './types.js';

export function parseDisableComment({
  comment,
  pragma,
  validationErrors,
}: {
  comment: Comment;
  pragma: string;
  validationErrors: ValidationError[];
}): LegacyComment | NonLegacyComment | undefined {
  // If this is a regular ESLint/Oxlint disable comment and not a legacy pragma,
  // then ignore it.
  if (!comment.comment?.startsWith(pragma)) {
    return {
      type: 'nonlegacy',
      file: comment.file,
      startLine: comment.startLine,
      endLine: comment.endLine,
      rules: comment.rules,
    };
  }

  // Make sure this comment uses `*-disable-next-line`, otherwise it's a gap that
  // allows users to bypass the legacy linting system by converting a valid
  // legacy comment into a block `*-disable` comment to include new errors
  if (comment.type !== 'next-line') {
    validationErrors.push({
      message: `Legacy comment must use *-disable-next-line`,
      location: {
        file: comment.file,
        line: comment.startLine,
      },
    });
    return undefined;
  }

  // Since legacy comments are generated, we can be strict about whitespace
  const parts = new RegExp(`^${pragma} \\((.*)\\) ([a-zA-Z0-9_-]{8})$`);
  const match = comment.comment.match(parts);
  if (!match) {
    validationErrors.push({
      message: `Malformed legacy comment: ${comment.comment}`,
      location: {
        file: comment.file,
        line: comment.startLine,
      },
    });
    return undefined;
  }

  const rules = match[1].split(',').map((rule) => rule.trim());
  const id = match[2];

  return {
    type: 'legacy',
    file: comment.file,
    startLine: comment.startLine,
    endLine: comment.endLine,
    legaciedRules: rules,
    nonLegaciedRules: comment.rules.filter((rule) => !rules.includes(rule)),
    id,
  };
}
