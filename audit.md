# Test audit: behaviors that may encode production bugs

**Scope:** all 22 test files (~6,000 lines) audited against all production source (~2,000
lines). Method: read every production module first to build a model of intended behavior,
then cross-checked each test's expectations against that model, real ESLint/Oxlint
semantics, and the workflows described in the README. One suspected bug was verified
empirically with git.

**Status (2026-07-07):** Findings 2 and 3 have since been fixed (see the status notes in
their sections). All other findings remain open.

## High-confidence findings

These are cases where the tests either pin behavior that looks wrong, or are structured so
that the buggy path is never exercised.

### 1. `legacy-errors` wipes database entries for files untouched by the run

[src/legacy/legacyExistingErrors.ts:47](src/legacy/legacyExistingErrors.ts#L47) ends with
`database.setIds(getIds())` — a full replacement. `getIds()` only contains IDs generated or
merged during this run. An existing legacy comment in a file with no *new* lint errors
never passes through `generateId`, because its violations are suppressed by its own disable
comment and therefore never appear in the piped lint results. Its database entry is
silently dropped, and the next `validate` reports it as "Unregistered legacy error."

The README's re-legacy workflow ("disable the CI check in the PR that re-legacies") would
hit this on the first re-run. The
[integration tests](src/__tests__/integration/legacyExistingErrors.integration.test.ts#L117)
always seed an **empty** database and run the command exactly once, so the replacement
semantics are never observable in the suite.

## Smaller findings

- **Module-level ID state makes the exported API single-shot** —
  [src/legacy/generateIds.ts:3](src/legacy/generateIds.ts#L3). Two programmatic
  `legacyExistingErrors` calls in one process bleed IDs into each other's saved database
  (combining with finding 1, the second save contains the first run's IDs). The
  [integration test explicitly works around this](src/__tests__/integration/legacyExistingErrors.integration.test.ts#L72-L76)
  with `vi.resetModules()` — its comment even names the hazard ("so the two runs don't
  bleed ids into each other's database") — rather than surfacing it. Matters because
  [src/api.ts](src/api.ts) exports the function publicly.

## Uncertain — needs a maintainer's call

Each of these has a test asserting the current behavior, but the intent is ambiguous:

1. **Oxlint multi-label diagnostics: last span wins.**
   [src/legacy/parseResults.ts:115-121](src/legacy/parseResults.ts#L115-L121) keeps
   overwriting `lineNumber`, so the last span label determines where the disable comment is
   inserted, and [the test pins it](src/legacy/__tests__/parseResults.test.ts#L396) ("uses
   the line from the last span label"). Miette-style diagnostics conventionally put the
   *primary* span first, and the disable comment presumably needs to land where Oxlint
   anchors the violation (e.g. `no-dupe-keys` reports two labels). If real Oxlint output
   anchors on the first label, the generated comment would sit on the wrong line and fail
   to suppress. Was last-wins chosen deliberately from real output?
2. **Whole-database replacement (finding 1)** — flagged as a bug above, but if
   `legacy-errors` is genuinely meant as a one-shot command against a fresh database, the
   behavior is defensible and it's the README workflow that's inconsistent instead.

## Test-hygiene notes

- Temporal/TDD-framed comments that describe history rather than intent:
  [parseResults.test.ts:7-9](src/legacy/__tests__/parseResults.test.ts#L7-L9) ("keep
  passing now that…"),
  [parseResults.test.ts:39-40](src/legacy/__tests__/parseResults.test.ts#L39-L40) ("so
  existing tests keep recording…"),
  [addLegacyStatements.test.ts:421](src/legacy/__tests__/addLegacyStatements.test.ts#L418-L421)
  ("the property the refactor fixed"), and
  [addLegacyStatements.test.ts:283-286](src/legacy/__tests__/addLegacyStatements.test.ts#L283-L286)
  ("Update this test when that lands").
- No `it.fails`/`it.skip` suppressions found anywhere — good.

## Audited and found faithful

Areas examined closely where the tests correctly reflect both the code and real-world
linter semantics:

- The strict legacy-pragma regex suite (including whitespace and ID-shape rejections).
- ESLint's block-comment-only restriction for bare `eslint-disable`, and the absence of
  that restriction for Oxlint.
- The ESLint-config-comment rejection (`/* eslint rule: sev */`).
- Oxlint's prefix-insensitive non-disableable matching (consistent with the linked oxc
  source).
- JSX vs JS context expectations in `getFileContexts` (several fixtures traced by hand —
  the expected contexts are where an inserted comment is actually syntactically valid).
- Merge/ID-reuse semantics in `addLegacyStatements`, including the round-trip tests.
- The db/config/files/schema/printing utilities (aside from findings 2 and 4).
