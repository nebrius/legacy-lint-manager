#!/usr/bin/env node

import { join } from 'node:path';

import { Command } from '@commander-js/extra-typings';

import { init } from './init/init.js';
import { legacyExistingErrors } from './legacy/legacyExistingErrors.js';
import { DEFAULT_CONFIG_FILE_NAME } from './util/constants.js';
import { validate } from './validate/validate.js';

function addCommonOptions(command: Command) {
  return command
    .option(
      '--config <file>',
      'path to the configuration file',
      join(process.cwd(), DEFAULT_CONFIG_FILE_NAME)
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
    '--no-compare',
    "Disable comparing the current database with the compare branch's database"
  )
  .action((options) => {
    validate(options);
  });

addCommonOptions(program.command('legacy-errors'))
  .description('Mark existing lint errors as legacied')
  .action((options) => {
    void legacyExistingErrors(options, process.stdin);
  });

addCommonOptions(program.command('init'))
  .description('Create a new configuration file')
  .action(() => {
    void init({
      input: process.stdin,
      output: process.stdout,
    });
  });

program.parse();
