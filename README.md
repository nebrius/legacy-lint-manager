# Legacy Lint Manager

[![npm version](https://badge.fury.io/js/legacy-lint-manager.svg)](https://badge.fury.io/js/legacy-lint-manager) ![ci workflow](https://github.com/nebrius/legacy-lint-manager/actions/workflows/ci.yml/badge.svg) [![codecov](https://codecov.io/gh/nebrius/legacy-lint-manager/graph/badge.svg?token=T6O54TXTKU)](https://codecov.io/gh/nebrius/legacy-lint-manager)

A tool for enabling ESLint/Oxlint rules on codebases with legacy errors

## Known limitations

- If the built-in set of file ignores causes a file that you don't ignore to be ignored by this tool, then a user could add new lint violations that are supposed to be non-disableable
- If a second violation of the same rule is added to the same line, then it won't get flagged as a new violation
- Changes to the eslint config file itself to ignore a file that disables a non-disableable rule won't be detected
- Inline rule configs are not support. I strongly recommend you enable `noInlineConfig: true` in your eslint config.
- If a user completely fixes all lint violations on line with a legacy comment, and then copies that legacy comment to a new location and introduces new violations, those new violations would be considered a move of the existing legacy comment, not a new violation