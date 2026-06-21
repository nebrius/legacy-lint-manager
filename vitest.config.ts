import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // Test files and fixtures (including the sample codebase) are not
        // production code and should not count toward coverage.
        'src/**/__tests__/**',
        // cli.ts is thin Commander wiring verified end-to-end by the
        // out-of-process smoke test, which the in-process v8 collector cannot
        // instrument.
        'src/cli.ts',
      ],
    },
  },
});
