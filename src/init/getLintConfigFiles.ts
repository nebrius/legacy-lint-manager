import { readdirSync } from 'node:fs';

const ESLINT_LINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];

const OXLINT_LINT_CONFIG_FILES = ['.oxlintrc.json', 'oxlint.config.ts'];

import { join } from 'node:path';

export function getLintConfigFiles(repoRootDir: string) {
  const dirContents = readdirSync(repoRootDir);
  const eslintConfigFiles = dirContents
    .filter((file) => ESLINT_LINT_CONFIG_FILES.includes(file))
    .map((file) => join(repoRootDir, file));
  const oxlintConfigFiles = dirContents
    .filter((file) => OXLINT_LINT_CONFIG_FILES.includes(file))
    .map((file) => join(repoRootDir, file));
  return {
    eslint: eslintConfigFiles,
    oxlint: oxlintConfigFiles,
  };
}
