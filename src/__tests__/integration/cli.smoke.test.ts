import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_PRAGMA } from '../../util/constants.js';

const INTEGRATION_DIR = import.meta.dirname;
// The real fixture sources carry legacy comments for c0nsole1 / debugg02.
const FIXTURE_SRC = join(INTEGRATION_DIR, 'fixtures', 'project', 'src');
const DATABASES_DIR = join(INTEGRATION_DIR, 'fixtures', 'databases');

// The smoke test exercises the real built CLI, so it requires `npm run build`
// first. In CI the build step runs before tests; locally it is skipped if the
// CLI has not been built. It is intentionally excluded from coverage (the
// subprocess cannot be instrumented by the in-process v8 collector).
const CLI_PATH = join(INTEGRATION_DIR, '..', '..', '..', 'dist', 'cli.js');
const cliIsBuilt = existsSync(CLI_PATH);

// The built CLI always compares against the compare branch (git show main:...),
// so the smoke test runs it inside a throwaway git repo: a baseline is committed
// on main and the CLI validates on feature with the repo as cwd. Committing main
// to match the working state keeps the compare check silent, so the exit code
// reflects only the scenario database. The pid keeps parallel vitest workers from
// colliding on the same temp dir.
const REPO_DIR = join(
  tmpdir(),
  `lint-legacies-smoke-${process.pid.toString()}`
);
// git show interpolates these paths directly, so they must be repo-relative, and
// the CLI runs with the repo as cwd so it resolves them the same way.
const CONFIG_REL = 'legacy-lint.config.jsonc';
const DATA_REL = 'legacy-lint.data.json';

function git(args: string[]) {
  execFileSync('git', args, { cwd: REPO_DIR, stdio: 'pipe' });
}

function setupRepo(scenario: string) {
  rmSync(REPO_DIR, { recursive: true, force: true });
  mkdirSync(REPO_DIR, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(
    join(REPO_DIR, CONFIG_REL),
    JSON.stringify({
      ignoreWarnings: false,
      pragma: DEFAULT_PRAGMA,
      databaseFile: DATA_REL,
      nonDisableableRules: [],
      compareBranch: 'main',
      linterType: 'eslint',
    })
  );
  cpSync(join(DATABASES_DIR, scenario), join(REPO_DIR, DATA_REL));
  cpSync(FIXTURE_SRC, join(REPO_DIR, 'src'), { recursive: true });
  git(['add', '-A']);
  git(['commit', '-m', 'baseline']);
  git(['checkout', '-b', 'feature']);
}

function runCli() {
  execFileSync(
    process.execPath,
    [CLI_PATH, 'validate', '--config', CONFIG_REL],
    { cwd: REPO_DIR, stdio: 'pipe' }
  );
}

describe('CLI smoke test', () => {
  afterEach(() => {
    rmSync(REPO_DIR, { recursive: true, force: true });
  });

  it.skipIf(!cliIsBuilt)('exits 0 when validation passes', () => {
    setupRepo('all-used.json');
    expect(() => {
      runCli();
    }).not.toThrow();
  });

  it.skipIf(!cliIsBuilt)('exits non-zero when validation fails', () => {
    setupRepo('unregistered.json');
    let status: number | undefined;
    try {
      runCli();
    } catch (err) {
      status = (err as { status?: number }).status;
    }
    expect(status).toBe(1);
  });
});
