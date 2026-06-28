import { execSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import {
  autocompleteMultiselect,
  cancel,
  confirm,
  intro,
  isCancel,
  outro,
  select,
  text,
} from '@clack/prompts';

import { createConfig } from '../util/config.js';
import {
  DEFAULT_CONFIG_FILE_NAME,
  DEFAULT_DATABASE_FILE_NAME,
  DEFAULT_PRAGMA,
} from '../util/constants.js';
import { createDatabase } from '../util/db.js';
import { getEslintRules } from './getEslintRules.js';
import { getLintConfigFiles } from './getLintConfigFiles.js';

export async function init() {
  intro(`legacy-lint-manager`);
  const rootDir = process.cwd();

  const linterType = await getLinterType(rootDir);
  const ignoreWarnings = await getIgnoreWarnings();
  const pragma = await getPragma();
  const nonDisableableRules = await getNonDisableableRules(
    linterType.eslintRules
  );
  const compareBranch = await getCompareBranch(rootDir);
  const databaseFile = await getDatabaseFile();

  const configFilePath = join(rootDir, DEFAULT_CONFIG_FILE_NAME);
  createConfig({
    data: {
      linterType: linterType.type,
      ignoreWarnings,
      pragma,
      databaseFile,
      compareBranch,
      nonDisableableRules,
    },
    filePath: configFilePath,
  });

  const databaseFilePath = join(dirname(configFilePath), databaseFile);
  const db = createDatabase({
    filePath: databaseFilePath,
    databaseContents: [],
  });
  db.save();

  outro(
    `You're all set! Now run \`npx ${linterType.type} --format=json | npx legacy-lint-manager legacy-errors\` to get started.`
  );
}

async function wrap<T>(fn: () => Promise<T | symbol>): Promise<T> {
  const result = await fn();
  if (isCancel(result)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }
  return result;
}

async function getLinterType(rootDir: string): Promise<{
  type: 'eslint' | 'oxlint';
  eslintRules?: string[];
}> {
  const lintConfigs = getLintConfigFiles(rootDir);

  let type: 'eslint' | 'oxlint' | undefined =
    lintConfigs.eslint.length && !lintConfigs.oxlint.length
      ? 'eslint'
      : !lintConfigs.eslint.length && lintConfigs.oxlint.length
        ? 'oxlint'
        : undefined;

  if (!type) {
    type = await wrap(() =>
      select({
        message: 'Pick a project type.',
        options: [
          { value: 'eslint', label: 'ESLint' },
          { value: 'oxlint', label: 'Oxlint' },
        ],
      })
    );
  }

  if (type === 'eslint') {
    if (lintConfigs.eslint.length === 1) {
      return {
        type: 'eslint',
        eslintRules: await getEslintRules(lintConfigs.eslint[0]),
      };
    }
    return { type: 'eslint' };
  } else {
    return { type: 'oxlint' };
  }
}

async function getIgnoreWarnings(): Promise<boolean> {
  return wrap(() =>
    confirm({
      message: 'Ignore warnings?',
      initialValue: false,
    })
  );
}

async function getPragma(): Promise<string> {
  return wrap(() =>
    text({
      message: 'What should disable comments be prefixed with?',
      defaultValue: DEFAULT_PRAGMA,
      placeholder: DEFAULT_PRAGMA,
    })
  );
}

async function getDatabaseFile(): Promise<string> {
  return wrap(() =>
    text({
      message:
        'Where should the database file be stored relative to the config file?',
      defaultValue: DEFAULT_DATABASE_FILE_NAME,
      placeholder: DEFAULT_DATABASE_FILE_NAME,
    })
  );
}

function getCompareBranch(rootDir: string) {
  // Get the default branch if an explicit branch was not provided
  const defaultCompareBranch = execSync(
    'git symbolic-ref refs/remotes/origin/HEAD --short',
    {
      encoding: 'utf-8',
      cwd: rootDir,
    }
  )
    .replace('origin/', '')
    .trim();

  return wrap(() =>
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
    })
  );
}

async function getNonDisableableRules(eslintRules: string[] | undefined) {
  if (eslintRules) {
    return wrap(() =>
      autocompleteMultiselect({
        message: 'Which rules should not be disableable?',
        options: eslintRules.map((rule) => ({
          value: rule,
          label: rule,
        })),
        placeholder: 'Type to search...',
        maxItems: 10,
      })
    );
  } else {
    const rules = await wrap(() =>
      text({
        message: 'Which rules should not be disableable?',
        placeholder: 'Example: "no-console, no-debugger"',
        defaultValue: '',
      })
    );
    return rules.split(',').map((rule) => rule.trim());
  }
}
