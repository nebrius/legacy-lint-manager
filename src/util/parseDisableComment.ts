import { ID_LENGTH } from './constants.js';
import { commaSeparatedStringToArray, escapeRegex } from './string.js';
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
  const parts = new RegExp(
    `^${escapeRegex(pragma)} \\((.*)\\) ([a-zA-Z0-9_-]{${ID_LENGTH.toString()}})$`
  );
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

  const rulesInComment = commaSeparatedStringToArray(match[1]).filter(
    (rule) => {
      // Ensure that the rule in the comment also appears in the actual lint
      // disable, e.g. that rules on the RHS are also in the LHS
      if (!comment.rules.includes(rule)) {
        validationErrors.push({
          message: `Rule ${rule} in legacy comment is not in the actual lint disable list and should be removed.`,
          location: {
            file: comment.file,
            line: comment.startLine,
          },
        });
        return false;
      }
      return true;
    }
  );
  const id = match[2];

  // Make sure there is at least one valid rule in the legacy comment
  if (!rulesInComment.length) {
    validationErrors.push({
      message: 'Legacy comment has no valid rules and should be removed',
      location: {
        file: comment.file,
        line: comment.startLine,
      },
    });
    return undefined;
  }

  return {
    type: 'legacy',
    file: comment.file,
    startLine: comment.startLine,
    endLine: comment.endLine,
    legaciedRules: rulesInComment,
    nonLegaciedRules: comment.rules.filter(
      (rule) => !rulesInComment.includes(rule)
    ),
    id,
  };
}
