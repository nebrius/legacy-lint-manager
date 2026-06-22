import importIntegrityPlugin from 'import-integrity-lint';

export default {
  plugins: ['typescript'],
  categories: {
    correctness: 'error',
  },
  options: {
    typeAware: true,
  },
  jsPlugins: [
    { name: 'import-integrity', specifier: 'import-integrity-lint' },
    'eslint-plugin-simple-import-sort',
  ],
  ignorePatterns: [
    'dist',
    'coverage',
    'node_modules',
    'src/**/__tests__/**/project/**/*',
    'vitest.config.ts',
  ],
  rules: {
    // Core ESLint rules matching eslint.config.mjs
    'eslint/object-shorthand': 'error',
    'eslint/eqeqeq': 'error',
    'simple-import-sort/imports': 'error',

    // TypeScript rules matching eslint.config.mjs
    'typescript/consistent-type-imports': 'error',
    'typescript/no-unsafe-enum-comparison': 'off',

    ...importIntegrityPlugin.configs.recommended.rules,
  },
  settings: {
    'import-integrity': {
      packageRootDir: import.meta.dirname,
    },
  },
};
