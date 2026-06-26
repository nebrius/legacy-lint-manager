import tseslint from 'typescript-eslint';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-console': 'error',
      'no-debugger': 'error',
      'no-var': 'warn',
    },
  },
];
