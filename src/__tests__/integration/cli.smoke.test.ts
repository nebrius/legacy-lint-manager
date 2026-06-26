import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const INTEGRATION_DIR = import.meta.dirname;
const PROJECT_DIR = join(INTEGRATION_DIR, 'fixtures', 'project');
const DATABASES_DIR = join(INTEGRATION_DIR, 'fixtures', 'databases');
// A distinct working-db filename (still gitignored) keeps this file from
// racing the in-process integration test, which runs in a parallel worker and
// uses the real-world lint-legacies.json name.
const WORKING_DB = join(PROJECT_DIR, 'lint-legacies.smoke.json');

// The smoke test exercises the real built CLI, so it requires `npm run build`
// first. In CI the build step runs before tests; locally it is skipped if the
// CLI has not been built. It is intentionally excluded from coverage (the
// subprocess cannot be instrumented by the in-process v8 collector).
const CLI_PATH = join(INTEGRATION_DIR, '..', '..', '..', 'dist', 'cli.js');
const cliIsBuilt = existsSync(CLI_PATH);

function runCli(scenario: string) {
  cpSync(join(DATABASES_DIR, scenario), WORKING_DB);
  execFileSync(
    process.execPath,
    [
      CLI_PATH,
      'validate',
      '--root-dir',
      PROJECT_DIR,
      '--database-file',
      WORKING_DB,
      '--no-compare',
    ],
    { stdio: 'pipe' }
  );
}

describe('CLI smoke test', () => {
  afterEach(() => {
    rmSync(WORKING_DB, { force: true });
  });

  it.skipIf(!cliIsBuilt)('exits 0 when validation passes', () => {
    expect(() => {
      runCli('all-used.json');
    }).not.toThrow();
  });

  it.skipIf(!cliIsBuilt)('exits non-zero when validation fails', () => {
    let status: number | undefined;
    try {
      runCli('unregistered.json');
    } catch (err) {
      status = (err as { status?: number }).status;
    }
    expect(status).toBe(1);
  });
});
