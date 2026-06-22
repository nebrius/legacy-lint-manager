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
  .action((options) => {
    validate(options);
  });

addCommonOptions(program.command('legacy-errors'))
  .description('Mark existing lint errors as legacied')
  .action((options) => {
    void legacyExistingErrors(options);
  });

program.parse();
