#!/usr/bin/env node

import { Command } from '@commander-js/extra-typings';

import { legacyExistingErrors } from './legacy/legacyExistingErrors.js';
import { DEFAULT_PRAGMA } from './types.js';
import { validate } from './validate/validate.js';

const DEFAULT_DATABASE_FILE = 'lint-legacies.json';

function addCommonOptions(command: Command) {
  return command
    .option(
      '--database-file <file>',
      'path to the legacies database file',
      DEFAULT_DATABASE_FILE
    )
    .option(
      '--pragma <pragma>',
      'comment pragma used to mark legacied lint errors',
      DEFAULT_PRAGMA
    )
    .option(
      '--root-dir <dir>',
      'root directory to search for files',
      process.cwd()
    )
    .option('--verbose', 'enable verbose logging', false);
}

const program = new Command()
  .name('legacy-lint-manager')
  .description(
    'A tool for enabling ESLint/Oxlint rules on codebases with legacy errors'
  );

addCommonOptions(program.command('validate'))
  .description('Validate that legacied lint errors are still accurate')
  .option('--update', 'update the database', false)
  .option(
    '--compare-branch <branch>',
    'branch to validate the database against. Defaults to the branch resolved from origin/HEAD'
  )
  .option(
    '--no-compare',
    "Disable comparing the current database with the compare branch's database"
  )
  .action((options) => {
    validate({
      ...options,

      // Commander types compareBranch as optional, but we want an explicit
      // undefined value, so this coercion, while a no-op in practice, makes
      // TypeScript happy
      compareBranch: options.compareBranch ?? undefined,
    });
  });

addCommonOptions(program.command('legacy-errors'))
  .description('Mark existing lint errors as legacied')
  .option(
    '--ignore-warnings',
    'Ignore warnings when parsing results. If this is a new database, defaults to false, otherwise defaults to what is currently set in the database'
  )
  .option(
    '--non-disableable-rules <rules>',
    'Comma-separated list of rules that cannot be disabled, aside from legacied errors'
  )
  .action((options) => {
    const nonDisableableRules = options.nonDisableableRules
      ? options.nonDisableableRules.split(',').map((rule) => rule.trim())
      : undefined;
    void legacyExistingErrors(
      {
        ...options,
        nonDisableableRules,
      },
      process.stdin
    );
  });

program.parse();
