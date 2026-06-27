import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_PRAGMA } from '../../util/constants.js';

const INTEGRATION_DIR = import.meta.dirname;
const PROJECT_DIR = join(INTEGRATION_DIR, 'fixtures', 'project');
const DATABASES_DIR = join(INTEGRATION_DIR, 'fixtures', 'databases');
// Distinct config/data filenames (still gitignored) keep this file from racing
// the in-process integration test, which runs in a parallel worker and uses the
// real-world legacy-lint.* names.
const CONFIG_FILE = join(PROJECT_DIR, 'legacy-lint.smoke.config.jsonc');
const WORKING_DATA = join(PROJECT_DIR, 'legacy-lint.smoke.data.json');

// The smoke test exercises the real built CLI, so it requires `npm run build`
// first. In CI the build step runs before tests; locally it is skipped if the
// CLI has not been built. It is intentionally excluded from coverage (the
// subprocess cannot be instrumented by the in-process v8 collector).
const CLI_PATH = join(INTEGRATION_DIR, '..', '..', '..', 'dist', 'cli.js');
const cliIsBuilt = existsSync(CLI_PATH);

function runCli(scenario: string) {
  cpSync(join(DATABASES_DIR, scenario), WORKING_DATA);
  writeFileSync(
    CONFIG_FILE,
    JSON.stringify({
      ignoreWarnings: false,
      pragma: DEFAULT_PRAGMA,
      databaseFile: WORKING_DATA,
      nonDisableableRules: [],
      compareBranch: 'main',
    })
  );
  execFileSync(
    process.execPath,
    [CLI_PATH, 'validate', '--config', CONFIG_FILE, '--no-compare'],
    { stdio: 'pipe' }
  );
}

describe('CLI smoke test', () => {
  afterEach(() => {
    rmSync(WORKING_DATA, { force: true });
    rmSync(CONFIG_FILE, { force: true });
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
