# Legacy Lint Manager

[![npm version](https://badge.fury.io/js/legacy-lint-manager.svg)](https://badge.fury.io/js/legacy-lint-manager) ![ci workflow](https://github.com/nebrius/legacy-lint-manager/actions/workflows/ci.yml/badge.svg) [![codecov](https://codecov.io/gh/nebrius/legacy-lint-manager/graph/badge.svg?token=T6O54TXTKU)](https://codecov.io/gh/nebrius/legacy-lint-manager)

A tool for enabling ESLint/Oxlint rules on codebases with legacy errors

## Stuff to mention

To legacy new rules (say cause you added new lint rules to the config): Disable
the CI check in the PR that re-legacies, then re-enable in follow up PR

## Known limitations

- If the built-in set of file ignores causes a file that you don't ignore to be ignored by this tool, then a user could add new lint violations that are supposed to be non-disableable
- If a second violation of the same rule is added to the same line, then it won't get flagged as a new violation
- Changes to the eslint config file itself to ignore a file that disables a non-disableable rule won't be detected
- Inline rule configs are not support. I strongly recommend you enable `noInlineConfig: true` in your eslint config.
- If a user completely fixes all lint violations on line with a legacy comment, and then copies that legacy comment to a new location and introduces new violations, those new violations would be considered a move of the existing legacy comment, not a new violation
- Non JS/JSX/TS/TSX files are not analyzed (e.g. Vue, Svelte, etc. files)
- Legacy comments (and eslint-disable comments generally) are not vetted against current failures. I strongly recommend you use the `--report-unused-disable-directives` CLI flag to fail in order to keep legacy comments up to date.
- In-file ESLint configurations (e.g. `/* eslint "example/rule1": "error" */`) are not supported and will cause an error. If you use this pattern, you will need to remove the comments and move them to the ESLint config file instead.

## Weird notes

- Rule name normalization is different between ESLint and Oxlint. We apply how each linter works for accuracy