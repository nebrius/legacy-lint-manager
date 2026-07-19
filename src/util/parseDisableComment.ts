import { DEFAULT_UPDATE_COMMAND, ID_LENGTH } from './constants.js';
import { InternalError } from './error.js';
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
  errorOnUnusedRules,
}: {
  comment: Comment;
  pragma: string;
  validationErrors: ValidationError[];
  errorOnUnusedRules: boolean;
}): LegacyComment | NonLegacyComment | undefined {
  // If this is a regular ESLint/Oxlint disable comment and not a legacy pragma,
  // then ignore it.
  if (!comment.comment?.startsWith(pragma)) {
    return {
      type: 'nonlegacy',
      file: comment.file,
      startIndex: comment.startIndex,
      endIndex: comment.endIndex,
      startLine: comment.startLine,
      endLine: comment.endLine,
      rules: comment.rules,
      descriptionStartIndex: comment.descriptionStartIndex,
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

  const unusedLegaciedRules = new Set<string>();
  const rulesInComment = commaSeparatedStringToArray(match[1]).filter(
    (rule) => {
      // Ensure that the rule in the comment also appears in the actual lint
      // disable, e.g. that rules on the RHS are also in the LHS
      if (!comment.rules.includes(rule)) {
        unusedLegaciedRules.add(rule);
        if (errorOnUnusedRules) {
          validationErrors.push({
            message: `Rule ${rule} in legacy comment is not in the actual lint disable list. Run \`${DEFAULT_UPDATE_COMMAND}\` to remove it.`,
            location: {
              file: comment.file,
              line: comment.startLine,
            },
          });
        }
        return false;
      }
      return true;
    }
  );
  const id = match[2];

  // Make sure there is at least one valid rule in the legacy comment
  if (!rulesInComment.length && errorOnUnusedRules) {
    validationErrors.push({
      message: 'Legacy comment has no valid rules and should be removed',
      location: {
        file: comment.file,
        line: comment.startLine,
      },
    });
    return undefined;
  }

  /* v8 ignore start */
  if (!comment.descriptionStartIndex) {
    throw new InternalError(
      'Legacy comment description index is unexpectedly missing'
    );
  }
  /* v8 ignore stop */

  // Index of the opening parenthesis of the legacy rules section, accounting
  // for the `--`, pragma, spaces, and opening paren
  const legaciedRulesStartIndex =
    comment.descriptionStartIndex + pragma.length + 4;
  return {
    type: 'legacy',
    file: comment.file,
    descriptionStartIndex: comment.descriptionStartIndex,
    startIndex: comment.startIndex,
    endIndex: comment.endIndex,
    startLine: comment.startLine,
    endLine: comment.endLine,
    legaciedRulesStartIndex,
    legaciedRulesEndIndex: legaciedRulesStartIndex + match[1].length + 2,
    legaciedRules: rulesInComment,
    nonLegaciedRules: comment.rules.filter(
      (rule) => !rulesInComment.includes(rule)
    ),
    unusedLegaciedRules: Array.from(unusedLegaciedRules),
    id,
  };
}
