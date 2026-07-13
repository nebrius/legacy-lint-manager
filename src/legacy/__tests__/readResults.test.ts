import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MockInstance } from 'vitest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { readResults } from '../readResults.js';

// readResults spawns the configured lint command and reads its stdout, so the
// tests drive it with real subprocesses instead of a fake ChildProcess. `node`
// is always available (process.execPath) and `-e` lets each case emit exactly
// the stdout/stderr and exit code the branch under test needs. This mirrors how
// the integration and smoke tests already shell out to real binaries.
function cmd(script: string, ...extra: string[]) {
  return { command: process.execPath, args: ['-e', script, ...extra] };
}

function loggedErrors(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => String(call[0])).join('\n');
}

// On a parse failure or unexpected exit code, readResults logs diagnostics and
// calls process.exit(1) — from inside the child's async 'close' handler, which
// can fire slightly after the test that started it has moved on. The stubs are
// therefore installed for the whole file rather than per test: a per-test stub
// torn down in afterEach would let a late 'close' reach vitest's real
// process.exit guard and surface as an unhandled error. Kept file-wide, a late
// exit call just hits the no-op.
let exitSpy: MockInstance<typeof process.exit>;
let errorSpy: MockInstance<typeof console.error>;

beforeAll(() => {
  exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

// Runs a command down the process-exit path and resolves with the exit code and
// the diagnostics logged along the way. A one-shot implementation captures this
// test's exit call (the persistent no-op above absorbs any other), so awaiting
// keeps the test alive until that specific exit has run.
function runToExit(
  args: Parameters<typeof readResults>[0]
): Promise<{ code: number | undefined; logged: string }> {
  return new Promise((resolve) => {
    exitSpy.mockImplementationOnce((code) => {
      resolve({
        code: typeof code === 'number' ? code : undefined,
        logged: loggedErrors(errorSpy),
      });
      return undefined as never;
    });
    void readResults(args);
  });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legacy-lint-read-results-'));
  exitSpy.mockClear();
  errorSpy.mockClear();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readResults', () => {
  describe('eslint', () => {
    it('parses stdout as JSON when the command exits 0', async () => {
      const payload = [{ filePath: 'a.ts', messages: [] }];
      await expect(
        readResults({
          linterType: 'eslint',
          lintCommand: cmd(
            `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`
          ),
          packageRootDir: dir,
        })
      ).resolves.toEqual(payload);
    });

    it('parses stdout as JSON when the command exits 1 (errors found)', async () => {
      // ESLint exits 1 when it reports lint errors, which is the common case
      // for this tool, so exit 1 must still be treated as success.
      await expect(
        readResults({
          linterType: 'eslint',
          lintCommand: cmd('process.stdout.write("[]"); process.exit(1)'),
          packageRootDir: dir,
        })
      ).resolves.toEqual([]);
    });

    it('exits 1 and logs guidance plus the offending stdout when it is not valid JSON', async () => {
      const { code, logged } = await runToExit({
        linterType: 'eslint',
        lintCommand: cmd('process.stdout.write("not json")'),
        packageRootDir: dir,
      });

      expect(code).toBe(1);
      expect(logged).toContain('Could not JSON parse linter output');
      // The unparseable stdout is echoed back to help diagnose the failure.
      expect(logged).toContain('not json');
    });

    it('exits 1 and logs the exit code and stderr on an unexpected exit code', async () => {
      const { code, logged } = await runToExit({
        linterType: 'eslint',
        lintCommand: cmd('process.stderr.write("boom"); process.exit(2)'),
        packageRootDir: dir,
      });

      expect(code).toBe(1);
      expect(logged).toContain(
        'ESLint did not run successfully and exited with code 2'
      );
      expect(logged).toContain('boom');
    });

    it('truncates the logged stdout to the last 1kb for a large invalid payload', async () => {
      const { code, logged } = await runToExit({
        linterType: 'eslint',
        lintCommand: cmd('process.stdout.write("x".repeat(2000))'),
        packageRootDir: dir,
      });

      expect(code).toBe(1);
      expect(logged).toContain('stdout (last 1kb only)');
    });
  });

  describe('oxlint', () => {
    it('parses stdout as JSON regardless of the exit code', async () => {
      // Oxlint's exit codes are not meaningful (1 covers both "errors found"
      // and "config broken"), so a non-zero exit with parseable JSON on stdout
      // is still treated as success.
      await expect(
        readResults({
          linterType: 'oxlint',
          lintCommand: cmd('process.stdout.write("[]"); process.exit(1)'),
          packageRootDir: dir,
        })
      ).resolves.toEqual([]);
    });

    it('exits 1 and logs guidance when stdout is not valid JSON', async () => {
      const { code, logged } = await runToExit({
        linterType: 'oxlint',
        lintCommand: cmd('process.stdout.write("nope"); process.exit(1)'),
        packageRootDir: dir,
      });

      expect(code).toBe(1);
      expect(logged).toContain('Could not JSON parse linter output');
    });
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(
      readResults({
        linterType: 'eslint',
        lintCommand: {
          command: 'definitely-not-a-real-binary-xyz',
          args: [],
        },
        packageRootDir: dir,
      })
    ).rejects.toThrow(/ENOENT/);
  });

  it('runs the command in the given directory and forwards its args', async () => {
    // The child reports its own cwd and first extra arg back as JSON, proving
    // both that `dir` becomes the spawn cwd and that args after the script are
    // forwarded. realpathSync resolves the macOS /var -> /private/var symlink so
    // the comparison holds there and is a no-op on Linux CI.
    const result = (await readResults({
      linterType: 'eslint',
      lintCommand: cmd(
        'process.stdout.write(JSON.stringify({ cwd: process.cwd(), arg: process.argv[1] }))',
        'MARKER'
      ),
      packageRootDir: dir,
    })) as { cwd: string; arg: string };

    expect(result.cwd).toBe(realpathSync(dir));
    expect(result.arg).toBe('MARKER');
  });
});
