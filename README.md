# Legacy Lint Manager

[![npm version](https://badge.fury.io/js/legacy-lint-manager.svg)](https://badge.fury.io/js/legacy-lint-manager) ![ci workflow](https://github.com/nebrius/legacy-lint-manager/actions/workflows/ci.yml/badge.svg) [![codecov](https://codecov.io/gh/nebrius/legacy-lint-manager/graph/badge.svg?token=T6O54TXTKU)](https://codecov.io/gh/nebrius/legacy-lint-manager)

A tool for enabling ESLint/Oxlint rules on codebases with legacy errors

## Stuff to mention

To legacy new rules (say cause you added new lint rules to the config): Disable
the CI check in the PR that re-legacies, then re-enable in follow up PR

When legacying new rules on a codebase that has been previously legacied, always run the validate command first to ensure there are no existing validation errors (it won't pick up on the new rules)

## Known limitations

- If a second violation of the same rule is added to the same line with an already legacied error that is non-disableable, then it won't get flagged as violation
- Changes to the eslint config file itself to ignore a file that disables a non-disableable rule won't be detected
- If a user completely fixes all lint violations on line with a legacy comment, and then copies that legacy comment to a new location and introduces new violations, those new violations would be considered a move of the existing legacy comment, not a new violation
- Non JS/JSX/TS/TSX files are not analyzed (e.g. Vue, Svelte, etc. files)
- Legacy comments (and eslint-disable comments generally) are not vetted against current failures. I strongly recommend you use the `--report-unused-disable-directives` CLI flag to fail in order to keep legacy comments up to date.
- In-file ESLint configurations (e.g. `/* eslint "example/rule1": "error" */`) are not supported and will cause an error. If you use this pattern, you will need to remove the comments and move them to the ESLint config file instead.
- API is not idempotent. The second run will produce spurious and unreliable IDs
- There are a small number of rules in Oxlint (5 in v1.71.0) where we cannot determine where the disable comment should be placed, and will place it on the wrong line when editing. This happens in rules where diagnostics correspond to more than one statement (called a span internally), and they don't surface which span the disable comment should be placed next to, nor is there a way for us to deterministically infer it.
- `legacy-errors` is not supported on Windows systems outside of WSL due to subprocess commands
- In monorepo mode, if the legacy processessing for a package half way throught the list of packages fails, then the remaining packages will not be processed.

## Random notes

- Rule name normalization is different between ESLint and Oxlint. We apply how each linter works for accuracy, but you should be aware of some peculiar design choices in Oxlint. Oxlint actually ignores namespaces in rule names, so `@typescript-eslint/no-explicit-any` and `eslint/no-explicit-any` are treated as the same rule, and `// oxlint-disable @typescript-eslint/no-explicit-any` will disable `eslint/no-explicit-any` errors in addition to the typescript ones.
- Talk about collision odds and what happens, referencing src/util/constants.ts
- Explicitly call out that lint results should be piped directly to the legacy command, and doing anything else is at your own risk