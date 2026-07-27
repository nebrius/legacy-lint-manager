---
name: legacy-lint-validation
description: >
  Use when `legacy-lint-manager validate` fails, locally or in CI, with
  errors like "cannot be disabled", "New legacy entries cannot be added",
  "Duplicate legacy ID", "Unregistered legacy error", "Malformed legacy
  comment", "is not defined in the database", or "does not match ... the
  compare config". Also use when ESLint reports "Unused eslint-disable
  directive" for a legacy comment after you fix its violation, and when
  resolving a merge conflict on the legacy lint database file (default
  `legacy-lint.data.json`). Explains the two halves of a legacy comment,
  which failures mean fix-the-code, how to retire a grant you fixed, when to
  run validate --update, which resolutions are forbidden, and how to resolve
  database merge conflicts safely.
license: MIT
---

# Resolving legacy-lint-manager validation failures

## How this tool works

legacy-lint-manager lets a codebase turn on ESLint/Oxlint rules while
exempting ("legacying") existing violations. It is a one-way ratchet:
the set of legacied errors can shrink, but it can never grow. Three
artifacts work together:

- Generated legacy comments in source, of the form
  `// eslint-disable-next-line rule1 -- <pragma> (rule1) <id>`. Every legacy
  comment has two halves, split at the `--`, and the distinction is critical:
  - **Before `--`** is an ordinary ESLint directive
    (`// eslint-disable-next-line rule1`). This half is plain ESLint, not
    bookkeeping — you may edit it by hand (e.g. to remove a rule you fixed).
  - **After `--`** is the *legacy statement* (`<pragma> (rule1) <id>`): the
    tool's bookkeeping that ties this grant to the database. Never hand-edit
    this half. `validate --update` owns it and rewrites it to match the
    directive.
- A database file (default `legacy-lint.data.json`) mapping each ID to its
  legacied rules
- A config file (default `legacy-lint.config.jsonc`) with enforcement
  settings

`validate` checks all three against each other and against the compare
branch (usually `main`). A failure almost always means the ratchet is
working as intended: it caught a new violation, or damage to a generated
artifact. It is not a bug to route around.

## Hard rules

Never do any of the following, even though they can make validation pass
locally. They defeat the ratchet, and CI validates against the compare
branch, so they fail there anyway:

1. Never hand-edit the database file.
2. Never write a new legacy comment or copy an existing one — the pragma says
   "DO NOT COPY", and each grant is one-time, for one violation. Never
   hand-edit the *legacy statement* (the half after `--`).
   - But you MAY edit the *directive* half (before `--`) to remove a rule whose
     violation you fixed — that retires the grant (see "Retiring a grant after
     you fix its violation"); `--update` then syncs the legacy statement.
3. Never relax the config relative to the compare branch: do not remove
   entries from `nonDisableableRules`, add to `ignorePackagePaths`, change
   `pragma` or `compareBranch`, or delete package config override files.
4. Never convert a legacy comment to a block (`eslint-disable`) or
   same-line (`eslint-disable-line`) form.

## When the fix is one command

These messages come from `validate` itself and mean legacied violations were
fixed, so the generated artifacts are now stale. This is the happy path:

- "Legacied lint errors were fixed, good job!"
- "Rule X in legacy comment is not in the actual lint disable list."
- "Legacy comment has no valid rules and should be removed"

Run `npx legacy-lint-manager validate --update`, then commit the modified
files. Do not edit the legacy statements or the database yourself.

(The related ESLint error "Unused eslint-disable directive" is a *different*
check and is not fixed by `--update` alone — see "Retiring a grant after you
fix its violation" below.)

## Retiring a grant after you fix its violation

Any change that makes a legacied violation stop firing turns its grant into
dead weight — the directive is now suppressing nothing. Common triggers:

- Deleting the offending code outright.
- Adding the consumer that makes a `no-unused-exports` / `no-test-only-imports`
  grant unnecessary.
- Replacing an `any` with a concrete type, clearing a legacied
  `no-explicit-any` — one edit often clears several downstream `any` errors,
  and every grant it retires must be reconciled.

ESLint's own `--report-unused-disable-directives` (a separate check from
`validate`) then fails with:

    error  Unused eslint-disable directive (no problems were reported from 'rule1')

`validate --update` will NOT resolve this on its own. It never consults live
lint results and never decides which rules are still needed — it only rewrites
the legacy statement (after `--`) to match the rules left in the directive
(before `--`), and prunes database entries for comments that no longer exist.
So the flow is directive-first: you retire the grant, the tool follows.

1. Edit the DIRECTIVE (the half before `--`) to drop the fixed rule:

   - If the directive lists other rules, remove just the fixed one:

         before:  // eslint-disable-next-line foo, bar -- <pragma> (foo, bar) <id>
         after:   // eslint-disable-next-line bar      -- <pragma> (foo, bar) <id>

   - If it was the only rule, delete the entire comment line — nothing is left
     to suppress:

         before:  // eslint-disable-next-line foo -- <pragma> (foo) <id>
         after:   (comment removed)

2. Run `validate --update`. For a trimmed directive it reconciles the legacy
   statement to match the rules left — `(foo, bar)` → `(bar)`:

       result:  // eslint-disable-next-line bar      -- <pragma> (bar) <id>

   For a comment you deleted whole, it prunes that ID from the database.

3. Commit the edited source and the database together.

Common mistake: skipping step 1 and expecting `--update` to notice the fix.
It won't — it does not read lint results, so with the directive untouched the
statement still matches it and `--update` is a no-op. Editing the directive
half is expected and allowed (it is ordinary ESLint); hand-editing the legacy
statement or the database is not (Hard rules 1-2). Deleting a whole comment
plus `--update` is what prunes its database entry in sync — never delete the
entry by hand.

## Resolving database merge conflicts

The database file is written as a single line, so git never partially
merges it: any concurrent change conflicts on the whole file. Resolution is
direction-sensitive, and getting it backwards wedges the branch:

1. Take the compare branch's side of the conflict, never your branch's
   side and never a hand-merged combination of the two. Be careful about
   which side that is: during a merge the compare branch is usually
   `--theirs`, but during a rebase it is usually `--ours`. Verify before
   picking.
2. Run `npx legacy-lint-manager validate --update` and commit the result.
   This prunes any entries whose legacy comments no longer exist in the
   merged code.
3. If that run fails with "Unregistered legacy error", those grants were
   consumed on the compare branch (the violations were already fixed
   there). Remove each surviving comment, fix its violation, and run
   `--update` again.

Taking your branch's side instead can keep entries the compare branch
removed. Validation rejects those as new entries before `--update` gets a
chance to reconcile, which is the wedged state.

## All other errors

- **"Rule X cannot be disabled."** A new suppression was added for a rule
  the repo has marked non-disableable. Fix the violation instead of
  suppressing it.
- **"Disabling all rules is not allowed because some rules are configured
  as non-disableable"** A blanket disable comment with no rule list. List
  the specific rules to disable instead, or fix the violations.
- **"Duplicate legacy ID X."** A legacy comment was copy-pasted. Remove the
  copied comment and fix the violation it was suppressing.
- **"Unregistered legacy error. New errors cannot be legacied."** A legacy
  comment carries an ID that is not in the database, meaning it was written
  by hand. Remove the comment and fix the violation.
- **"Rule X for legacy ID Y is not defined in the database."** A legacy
  comment was hand-edited to piggyback another rule onto an existing grant.
  Revert the edit and fix the new violation.
- **"Malformed legacy comment"** or **"Legacy comment must use
  \*-disable-next-line"** A legacy comment was damaged by hand-editing or a
  bad merge. Restore it to its original form from git history, or remove it
  and fix the violation.
- **"Legacy ID X does not exist in the database on BRANCH"** or **"New
  rules cannot be added to existing legacy entries."** The database file
  grew relative to the compare branch. Revert the database changes. One
  exception: when the change also removes a package from
  `ignorePackagePaths`, new entries whose legacy comments live in that
  package are sanctioned onboarding and pass validation. Seeing this
  error anyway means the flagged entry does not belong to the
  un-ignored package, or its database entry lists rules beyond what its
  legacy comment declares.
- **"... does not match ... the compare config"**, **"Non-disableable rules
  cannot be removed from the compare branch."**, **"New ignored packages
  cannot be added to the config."**, or a package config override error:
  enforcement settings were relaxed relative to the compare branch. Revert
  the config change.
- **"Errors parsing file"** The source file has a syntax error. Fix it and
  validation will proceed.
- **"ESLint configuration comments are not supported"** An in-file config
  comment like `/* eslint "some/rule": "error" */`. Move the configuration
  into the ESLint config file.
- **A raw git `fatal:` error** is a compare-branch checkout problem
  (usually a shallow or single-branch fetch in CI), not a code problem.
  Report it to the human; fixing it means changing CI checkout settings.

## When to stop and ask the human

If new or changed code genuinely seems to need a new suppression, stop.
Registering new legacy errors is a human decision made with the
`legacy-errors` command, and it is intentionally impossible through
`validate`. Report the violation and your reasoning instead of trying to
make validation pass.

Full documentation:
https://github.com/nebrius/legacy-lint-manager#readme
