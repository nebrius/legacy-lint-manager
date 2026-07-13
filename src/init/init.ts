import { execSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

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
import { getPackages } from '@manypkg/get-packages';

import type { Config } from '../util/config.js';
import { createConfig } from '../util/config.js';
import {
  DEFAULT_CONFIG_FILE_NAME,
  DEFAULT_DATABASE_FILE_NAME,
  DEFAULT_PRAGMA,
} from '../util/constants.js';
import { createDatabase } from '../util/db.js';
import { getRepoRoot } from '../util/files.js';
import { commaSeparatedStringToArray } from '../util/string.js';
import { getEslintRules } from './getEslintRules.js';
import { getLintConfigFiles } from './getLintConfigFiles.js';

type IO = {
  input: Readable;
  output: Writable;
};

// init takes in IO so that we can override it in tests
export async function init(io: IO) {
  intro(`legacy-lint-manager`);
  const repoRootDir = getRepoRoot(process.cwd());

  const linterType = await getLinterType(repoRootDir, io);
  const lintCommand = await getLintCommand(io, linterType.type);
  const ignoreWarnings = await getIgnoreWarnings(io);
  const isMonorepo = await getIsMonorepo(io);
  const pragma = await getPragma(io);
  const nonDisableableRules = await getNonDisableableRules(
    linterType.eslintRules,
    io
  );
  const compareBranch = await getCompareBranch(repoRootDir, io);
  const databaseFile = await getDatabaseFile(io);

  const configFilePath = join(repoRootDir, DEFAULT_CONFIG_FILE_NAME);
  const configData: Config = {
    linterType: linterType.type,
    lintCommand,
    ignoreWarnings,
    pragma,
    databaseFile,
    compareBranch,
    nonDisableableRules,
  };
  if (isMonorepo) {
    configData.monorepoConfig = {
      ignorePackagePaths: [],
    };
  }
  createConfig({
    data: configData,
    filePath: configFilePath,
  });

  const databaseFilePath = join(dirname(configFilePath), databaseFile);
  const db = createDatabase({
    filePath: databaseFilePath,
    databaseContents: [],
  });
  db.save();

  outro(
    `You're all set! Now run \`npx legacy-lint-manager legacy-errors\` to get started.`
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

async function getLinterType(
  repoRootDir: string,
  io: IO
): Promise<{
  type: 'eslint' | 'oxlint';
  eslintRules?: string[];
}> {
  const lintConfigs = getLintConfigFiles(repoRootDir);

  let type: 'eslint' | 'oxlint' | undefined =
    lintConfigs.eslint.length && !lintConfigs.oxlint.length
      ? 'eslint'
      : !lintConfigs.eslint.length && lintConfigs.oxlint.length
        ? 'oxlint'
        : undefined;

  if (!type) {
    type = await wrap(() =>
      select({
        message: 'Which linter do you use?',
        options: [
          { value: 'eslint', label: 'ESLint' },
          { value: 'oxlint', label: 'Oxlint' },
        ],
        ...io,
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

async function getLintCommand(
  io: IO,
  linterType: 'eslint' | 'oxlint'
): Promise<Config['lintCommand']> {
  const defaultCommand = `npx ${linterType} --format=json`;
  const value = await wrap(() =>
    text({
      message:
        'What command should I run to get the list of lint errors when adding legacy comments?',
      defaultValue: defaultCommand,
      placeholder: defaultCommand,
      ...io,
      validate(value) {
        // We allow empty values since we supply a default
        if (!value) {
          return;
        }
        if (
          value.includes('"') ||
          value.includes("'") ||
          value.includes('\\ ')
        ) {
          return 'Command cannot contain quoted arguments or escaped spaces. If you need these, add a dummy value here and edit the config file directly after initialization';
        }
      },
    })
  );
  const [command, ...args] = value.trim().split(/\s+/);
  return {
    command,
    args,
  };
}

async function getIgnoreWarnings(io: IO): Promise<boolean> {
  return wrap(() =>
    confirm({
      message: 'Ignore lint warnings?',
      initialValue: false,
      ...io,
    })
  );
}

async function getIsMonorepo(io: IO): Promise<boolean> {
  const { tool } = await getPackages(process.cwd());
  return wrap(() =>
    confirm({
      message: 'Do you want to enable monorepo mode?',
      initialValue: tool.type !== 'root',
      ...io,
    })
  );
}

async function getPragma(io: IO): Promise<string> {
  return wrap(() =>
    text({
      message: 'What should legacied disable comments be prefixed with?',
      defaultValue: DEFAULT_PRAGMA,
      placeholder: DEFAULT_PRAGMA,
      ...io,
    })
  );
}

async function getDatabaseFile(io: IO): Promise<string> {
  return wrap(() =>
    text({
      message:
        'Where should the database file be stored, relative to the config file?',
      defaultValue: DEFAULT_DATABASE_FILE_NAME,
      placeholder: DEFAULT_DATABASE_FILE_NAME,
      ...io,
    })
  );
}

function getCompareBranch(repoRootDir: string, io: IO) {
  // Get the default branch if an explicit branch was not provided
  const defaultCompareBranch = execSync(
    'git symbolic-ref refs/remotes/origin/HEAD --short',
    {
      encoding: 'utf-8',
      cwd: repoRootDir,
    }
  )
    .replace('origin/', '')
    .trim();

  return wrap(() =>
    text({
      message:
        'What branch should CI compare the legacied errors list be compared against?',
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
      ...io,
    })
  );
}

async function getNonDisableableRules(
  eslintRules: string[] | undefined,
  io: IO
) {
  if (eslintRules) {
    return wrap(() =>
      autocompleteMultiselect({
        message: 'Which rules should be flagged if disabled?',
        options: eslintRules.map((rule) => ({
          value: rule,
          label: rule,
        })),
        placeholder: 'Type to search...',
        maxItems: 10,
        ...io,
      })
    );
  } else {
    const rules = await wrap(() =>
      text({
        message: 'Which rules should be flagged if disabled?',
        placeholder: 'Example: "no-console, no-debugger"',
        defaultValue: '',
        ...io,
      })
    );
    return commaSeparatedStringToArray(rules);
  }
}
