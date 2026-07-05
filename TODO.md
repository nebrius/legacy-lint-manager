- Oxc parse failures should be a validation error
- ESLint suppots another version of inline config that looks like `/* eslint "example/rule1": "error" */`, and you need to support. Oxlint has no equivalent
- Now that rules are tracked in the database, we need to have validate --update prune rules from legacy statements that still contain other valid rules
- Figure out a story for how to re-run legacy after a new config change
    - I think only safe story is to say `add --no-compare on PR that changes`, remove it in immediate follow up PR
- Support monorepos with nested config files but single database (perhaps keying by package name with list of enabled rules per-package)
- Bug report:

> parseResults canonicalizes oxlint codes to plugin/rule (e.g. eslint/no-console), and nonDisableableRules matching is exact string comparison (src/validate/validateDisableComments.ts:76,91). Oxlint disable directives accept the bare rule name (oxlint-disable-next-line no-console). If nonDisableableRules contains eslint/no-console, the bare-name comment disables the rule for oxlint but doesn't match the exact-string check → bypass. Needs a check of which alias forms oxlint honors in directives; fix would be normalizing both sides before comparison (or matching on rule-name suffix).

- (Low priority) Update get file list code to take into account eslint ignore setups. You can get this from ConfigArray.
- (Low priority) If we need to convert a non-legacy disable to a legacy that contains a comment, lift the comment to a
  separate line above the legacy disable.
