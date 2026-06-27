import { execSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import {
  autocompleteMultiselect,
  cancel,
  confirm,
  group,
  intro,
  outro,
  text,
} from '@clack/prompts';

import { createConfig } from '../util/config.js';
import {
  DEFAULT_CONFIG_FILE_NAME,
  DEFAULT_DATABASE_FILE_NAME,
  DEFAULT_PRAGMA,
} from '../util/constants.js';
import { createDatabase } from '../util/db.js';

export async function init() {
  intro(`legacy-lint-manager`);

  // Get the default branch if an explicit branch was not provided
  const defaultCompareBranch = execSync(
    'git symbolic-ref refs/remotes/origin/HEAD --short',
    {
      encoding: 'utf-8',
    }
  )
    .replace('origin/', '')
    .trim();

  const data = await group(
    {
      ignoreWarnings: () =>
        confirm({ message: 'Ignore warnings?', initialValue: false }),
      pragma: () =>
        text({
          message: 'What should disable comments be prefixed with?',
          defaultValue: DEFAULT_PRAGMA,
          placeholder: DEFAULT_PRAGMA,
        }),
      databaseFile: () =>
        text({
          message:
            'Where should the database file be stored relative to the config file?',
          defaultValue: DEFAULT_DATABASE_FILE_NAME,
          placeholder: DEFAULT_DATABASE_FILE_NAME,
        }),
      compareBranch: () =>
        text({
          message: 'What branch contains the canonical list of legacy issues?',
          defaultValue: defaultCompareBranch,
          placeholder: defaultCompareBranch,
          validate: (value) => {
            if (!value) {
              return;
            }
            const result = spawnSync('git', [
              'show-ref',
              '--verify',
              '--quiet',
              `refs/heads/${value}`,
            ]);
            if (result.status !== 0) {
              return `Branch "${value}" does not exist`;
            }
          },
        }),
      nonDisableableRules: () =>
        autocompleteMultiselect({
          message: 'Which rules should not be disableable?',
          options: [
            // TODO: dynamically populate
            { value: 'no-console', label: 'no-console' },
            { value: 'no-debugger', label: 'no-debugger' },
          ],
          placeholder: 'Type to search...',
          maxItems: 10,
        }),
    },
    {
      onCancel: () => {
        cancel('Operation cancelled.');
        process.exit(0);
      },
    }
  );

  const configFilePath = join(process.cwd(), DEFAULT_CONFIG_FILE_NAME);
  createConfig({
    data,
    filePath: configFilePath,
  });

  const databaseFilePath = join(dirname(configFilePath), data.databaseFile);
  const db = createDatabase({
    filePath: databaseFilePath,
    databaseContents: [],
  });
  db.save();

  outro(
    `You're all set! Now run \`npx legacy-lint-manager legacy-errors\` to get started.`
  );
}
