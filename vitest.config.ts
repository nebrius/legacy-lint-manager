import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'src',
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
        // init.ts is the interactive command (clack prompts + git); its tests
        // are handled separately, so it is excluded from the coverage target.
        'src/init/init.ts',
      ],
    },
  },
});
