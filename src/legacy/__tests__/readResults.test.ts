import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readResults } from '../readResults.js';

// readResults spawns the configured lint command and reads its stdout, so the
// tests drive it with real subprocesses instead of a fake ChildProcess. `node`
// is always available (process.execPath) and `-e` lets each case emit exactly
// the stdout/stderr and exit code the branch under test needs. This mirrors how
// the integration and smoke tests already shell out to real binaries.
function cmd(script: string, ...extra: string[]) {
  return { command: process.execPath, args: ['-e', script, ...extra] };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legacy-lint-read-results-'));
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
          dir,
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
          dir,
        })
      ).resolves.toEqual([]);
    });

    it('rejects when stdout is not valid JSON', async () => {
      await expect(
        readResults({
          linterType: 'eslint',
          lintCommand: cmd('process.stdout.write("not json")'),
          dir,
        })
      ).rejects.toThrow();
    });

    it('rejects with the stderr output when the command exits with an unexpected code', async () => {
      await expect(
        readResults({
          linterType: 'eslint',
          lintCommand: cmd('process.stderr.write("boom"); process.exit(2)'),
          dir,
        })
      ).rejects.toThrow('boom');
    });

    it('rejects with a code-bearing fallback message when there is no stderr', async () => {
      await expect(
        readResults({
          linterType: 'eslint',
          lintCommand: cmd('process.exit(2)'),
          dir,
        })
      ).rejects.toThrow(
        'ESLint did not run successfully and exited with code 2'
      );
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
          dir,
        })
      ).resolves.toEqual([]);
    });

    it('rejects when stdout is not valid JSON', async () => {
      await expect(
        readResults({
          linterType: 'oxlint',
          lintCommand: cmd('process.stdout.write("nope"); process.exit(1)'),
          dir,
        })
      ).rejects.toThrow();
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
        dir,
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
      dir,
    })) as { cwd: string; arg: string };

    expect(result.cwd).toBe(realpathSync(dir));
    expect(result.arg).toBe('MARKER');
  });
});
