export default [
  {
    rules: {
      'no-console': 'error',
      eqeqeq: 'error',
    },
  },
  {
    // 'no-console' is repeated to prove rule names are de-duplicated.
    rules: {
      'no-console': 'warn',
      'no-debugger': 'error',
    },
  },
];
