import type { Config } from '../util/config.js';
import type {
  LegacyComment,
  NonLegacyComment,
  ValidationError,
} from '../util/types.js';

export function validateDisableComments({
  nonDisableableRules,
  validationErrors,
  legacyComments,
  nonLegacyComments,
  linterType,
  databaseMap,
}: {
  nonDisableableRules: string[];
  validationErrors: ValidationError[];
  legacyComments: LegacyComment[];
  nonLegacyComments: NonLegacyComment[];
  linterType: Config['linterType'];
  databaseMap: Map<string, { foundInCode: boolean; rules: string[] }>;
}) {
  // Compare the database to the found comments
  for (const comment of legacyComments) {
    // Check if the ID is in the database (aka is a known legacy)
    const mapEntry = databaseMap.get(comment.id);
    if (mapEntry) {
      // Check if the ID was already found, aka the same ID was used more than once
      if (mapEntry.foundInCode) {
        validationErrors.push({
          message: `Duplicate legacy ID "${comment.id}". Each legacy ID can only be used once.`,
          location: {
            file: comment.file,
            line: comment.startLine,
          },
        });
      } else {
        for (const rule of comment.legaciedRules) {
          if (!mapEntry.rules.includes(rule)) {
            validationErrors.push({
              message: `Rule "${rule}" for legacy ID "${comment.id}" is not defined in the database.`,
              location: {
                file: comment.file,
                line: comment.startLine,
              },
            });
          }
        }
        mapEntry.foundInCode = true;
      }
    } else {
      validationErrors.push({
        message: `Unregistered legacy error. New errors cannot be legacied.`,
        location: {
          file: comment.file,
          line: comment.startLine,
        },
      });
    }
  }

  // Validate non-disableable rules are not used in non-legacied rules in legacy comments
  for (const comment of legacyComments) {
    for (const rule of comment.nonLegaciedRules) {
      if (isRuleNonDisableable({ rule, nonDisableableRules, linterType })) {
        validationErrors.push({
          message: `Rule "${rule}" cannot be disabled.`,
          location: {
            file: comment.file,
            line: comment.startLine,
          },
        });
      }
    }
  }

  // Validate non-disableable rules are not used in non-legacy comments
  for (const comment of nonLegacyComments) {
    for (const rule of comment.rules) {
      if (isRuleNonDisableable({ rule, nonDisableableRules, linterType })) {
        validationErrors.push({
          message: `Rule "${rule}" cannot be disabled.`,
          location: {
            file: comment.file,
            line: comment.startLine,
          },
        });
      }
    }
  }
}

function isRuleNonDisableable({
  rule,
  nonDisableableRules,
  linterType,
}: {
  rule: string;
  nonDisableableRules: string[];
  linterType: Config['linterType'];
}) {
  // ESLint uses a simple mechanism for comparing disable comment rules to
  // canonical rule names (it's just 1:1 matching)
  if (linterType === 'eslint') {
    return nonDisableableRules.includes(rule);
  }

  // Oxlint does this weird thing where they strip the namespace from rules and
  // compare the base rule-name. This means that `// oxlint-disable foo` matches
  // `package_one/foo` and `package_two/foo`. Apparently this is by design:
  // https://github.com/oxc-project/oxc/blob/777f02ae10c38d481c6c16563e55272c350def2c/crates/oxc_linter/src/disable_directives.rs#L317-L338
  const baseRule = rule.split('/').pop();
  for (const nonDisableableRule of nonDisableableRules) {
    const nonDisableableBaseRule = nonDisableableRule.split('/').pop();
    if (nonDisableableBaseRule === baseRule) {
      return true;
    }
  }
  return false;
}
