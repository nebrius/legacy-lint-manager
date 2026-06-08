import { join } from 'node:path';

import { includeIgnoreFile } from '@eslint/config-helpers';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import importIntegrityPlugin from 'import-integrity-lint';
import tseslint from 'typescript-eslint';

const ROOT_DIR = import.meta.dirname;

export default defineConfig([
  includeIgnoreFile(join(ROOT_DIR, '.gitignore')),
  {
    files: ['**/*.{js,mjs,jsx,ts,tsx,mts}'],
    languageOptions: {
      globals: globals.node,
    },
    plugins: { js, 'simple-import-sort': simpleImportSort },
    extends: ['js/recommended'],
    rules: {
      'object-shorthand': 'error',
      'simple-import-sort/imports': 'error',
      eqeqeq: 'error',

      // Handled by TypeScript eslint
      'no-unused-vars': 'off',
    },
    settings: {
      'import-integrity': {
        packageRootDir: import.meta.dirname,
        debugLogging: true,
        externallyImportedFiles: [
          'docs/.vitepress/config.mjs',
          'docs/.vitepress/theme/index.js',
        ],
      },
    },
  },

  importIntegrityPlugin.configs.recommended,

  ...tseslint.configs.strictTypeChecked.map((r) =>
    r.name === 'typescript-eslint/strict-type-checked'
      ? {
          ...r,
          files: ['**/*.{ts,tsx,mts}'],
        }
      : r
  ),
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: ROOT_DIR,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',

      // This rules doesn't make sense given that no erasable types is enabled
      // that prevents us from using enums
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
    },
  },
  {
    // disable type-aware linting on JS files
    files: ['**/*..jsx,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  eslintPluginPrettierRecommended,
]);
