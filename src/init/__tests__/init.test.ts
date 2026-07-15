import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readConfig } from '../../util/config.js';
import {
  DEFAULT_DATABASE_FILE_NAME,
  DEFAULT_PRAGMA,
} from '../../util/constants.js';
import { setVerbose } from '../../util/logging.js';
import { init } from '../init.js';

// getCompareBranch shells out to git unconditionally (default-branch lookup +
// branch validation), so stub it: the default branch is "main" and any branch
// validates successfully.
vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => 'main\n'),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

// MockReadable/MockWritable are copied from @clack/prompts' own test utilities
// (MIT licensed) so we can drive the interactive prompts with synthetic
// keypress events, exactly as clack tests its prompts. Source:
// https://github.com/bombshell-dev/clack/blob/55645c28fdc07d4d1e5875fa2cdcbbc83d6bc767/packages/prompts/test/test-utils.ts
class MockWritable extends Writable {
  public buffer: string[] = [];
  public isTTY = false;
  public columns = 80;
  public rows = 20;

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.buffer.push(chunk.toString());
    callback();
  }
}

class MockReadable extends Readable {
  protected _buffer: unknown[] | null = [];

  _read(): void {
    if (this._buffer === null) {
      this.push(null);
      return;
    }
    for (const val of this._buffer) {
      this.push(val);
    }
    this._buffer = [];
  }

  close(): void {
    this._buffer = null;
  }
}

let input: MockReadable;
let output: MockWritable;
let originalCwd: string;
let workDir: string;

// Wait until a prompt's message has been rendered to the mock output, so each
// keypress lands on the prompt that expects it rather than racing ahead. Polls
// on a wall-clock deadline (not a fixed setImmediate count) so it tolerates
// genuinely async steps between prompts — e.g. getLinterType awaits a dynamic
// import() of the detected ESLint config, which a tight setImmediate loop can
// outrun and spuriously time out on.
async function waitForText(sub: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (output.buffer.join('').includes(sub)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `Timed out waiting for prompt text: ${sub}\nRendered:\n${output.buffer.join('')}`
  );
}

function press(name: string): void {
  input.emit('keypress', '', { name });
}

function type(value: string): void {
  for (const char of value) {
    input.emit('keypress', char, { name: char });
  }
}

function backspace(count: number): void {
  for (let i = 0; i < count; i++) {
    input.emit('keypress', '', { name: 'backspace' });
  }
}

beforeEach(() => {
  input = new MockReadable();
  output = new MockWritable();
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), 'legacy-lint-init-'));
  // init derives its repoRootDir via getRepoRoot(process.cwd()), which walks up
  // to the nearest .git directory, so the work dir must look like a repo root.
  // node:child_process is mocked in this file, so a real `git init` isn't
  // available — but getRepoRoot only checks for a `.git` entry on disk, so an
  // empty .git directory is enough to anchor repoRootDir at workDir.
  mkdirSync(join(workDir, '.git'));
  // getIsMonorepo calls @manypkg/get-packages, which reads a package.json to
  // decide the monorepo default. Without one it throws, so give the work dir a
  // plain single-package manifest: manypkg resolves it as a lone `root` package,
  // making the monorepo prompt default to No.
  writeFileSync(
    join(workDir, 'package.json'),
    JSON.stringify({ name: 'work', version: '1.0.0', private: true })
  );
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  input.close();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // setVerbose mutates module-level state in logging.js; reset it so the
  // verbose-enabled test can't leak into others.
  setVerbose(false);
});

describe('init (interactive)', () => {
  it('writes a config and empty database from the prompt answers', async () => {
    // Empty work dir => no lint config detected => the linter must be selected.
    const result = init({ input, output, verbose: false });

    await waitForText('Which linter do you use?');
    press('return'); // first option: ESLint

    await waitForText('command should I run');
    press('return'); // accept the default lint command

    await waitForText('Ignore lint warnings?');
    press('return'); // initialValue: false

    await waitForText('monorepo mode');
    press('return'); // initialValue: false (single root package)

    await waitForText('prefixed with');
    press('return'); // defaultValue: DEFAULT_PRAGMA

    // No ESLint config on disk, so this is the free-text rules prompt.
    await waitForText('flagged if disabled');
    type('no-console,no-debugger');
    press('return');

    await waitForText('compare against');
    press('return'); // defaultValue: 'main' (from mocked git)

    await waitForText('database file be stored');
    press('return'); // defaultValue: DEFAULT_DATABASE_FILE_NAME

    await result;

    const config = readConfig(join(workDir, 'legacy-lint.config.jsonc'));
    expect(config).toEqual({
      linterType: 'eslint',
      lintCommand: { command: 'npx', args: ['eslint', '--format=json'] },
      ignoreWarnings: false,
      pragma: DEFAULT_PRAGMA,
      // init stores databaseFile relative, but readConfig resolves it to an
      // absolute path against the config's directory (the work dir).
      databaseFile: join(workDir, DEFAULT_DATABASE_FILE_NAME),
      compareBranch: 'main',
      nonDisableableRules: ['no-console', 'no-debugger'],
    });

    const database = JSON.parse(
      readFileSync(join(workDir, DEFAULT_DATABASE_FILE_NAME), 'utf-8')
    ) as unknown;
    expect(database).toEqual([]);
  });

  it('emits timing logs for the file writes when verbose is enabled', async () => {
    // init wires the verbose flag into setVerbose and wraps the config and
    // database writes in time(), so enabling verbose surfaces a labeled debug
    // line for each write. time() itself is unit-tested in logging.test.ts;
    // this covers the init-level wiring.
    const messages: string[] = [];
    vi.spyOn(console, 'debug').mockImplementation((msg: string) => {
      messages.push(msg);
    });

    // Empty work dir => the linter must be selected; drive the full prompt flow
    // so init reaches the writes that time() instruments.
    const result = init({ input, output, verbose: true });

    await waitForText('Which linter do you use?');
    press('return');

    await waitForText('command should I run');
    press('return');

    await waitForText('Ignore lint warnings?');
    press('return');

    await waitForText('monorepo mode');
    press('return');

    await waitForText('prefixed with');
    press('return');

    await waitForText('flagged if disabled');
    press('return');

    await waitForText('compare against');
    press('return');

    await waitForText('database file be stored');
    press('return');

    await result;

    const joined = messages.join('\n');
    expect(joined).toContain('Creating config file at');
    expect(joined).toContain('Creating database at');
  });

  it('records oxlint when it is chosen from the linter prompt', async () => {
    const result = init({ input, output, verbose: false });

    await waitForText('Which linter do you use?');
    press('down'); // move from ESLint to Oxlint
    press('return');

    await waitForText('command should I run');
    press('return'); // accept the default lint command

    await waitForText('Ignore lint warnings?');
    press('return');

    await waitForText('monorepo mode');
    press('return'); // initialValue: false (single root package)

    await waitForText('prefixed with');
    press('return');

    await waitForText('flagged if disabled');
    type('no-debugger');
    press('return');

    await waitForText('compare against');
    press('return');

    await waitForText('database file be stored');
    press('return');

    await result;

    const config = readConfig(join(workDir, 'legacy-lint.config.jsonc'));
    expect(config.linterType).toBe('oxlint');
    // The default lint command reflects the chosen linter.
    expect(config.lintCommand).toEqual({
      command: 'npx',
      args: ['oxlint', '--format=json'],
    });
    expect(config.nonDisableableRules).toEqual(['no-debugger']);
  });

  it('offers the ESLint rules for selection when a config is detected', async () => {
    // A single ESLint config on disk is auto-detected (no linter prompt), and
    // its rules are read (via getEslintRules) to populate the autocomplete
    // multiselect.
    writeFileSync(
      join(workDir, 'eslint.config.mjs'),
      "export default [{ rules: { 'no-console': 'error' } }];\n"
    );

    const result = init({ input, output, verbose: false });

    await waitForText('command should I run');
    press('return'); // accept the default lint command

    await waitForText('Ignore lint warnings?');
    press('return');

    await waitForText('monorepo mode');
    press('return'); // initialValue: false (single root package)

    await waitForText('prefixed with');
    press('return');

    await waitForText('flagged if disabled');
    press('down'); // focus the option and enter navigation mode
    press('space'); // toggle the focused rule
    press('return');

    await waitForText('compare against');
    press('return');

    await waitForText('database file be stored');
    press('return');

    await result;

    const config = readConfig(join(workDir, 'legacy-lint.config.jsonc'));
    expect(config.linterType).toBe('eslint');
    expect(config.nonDisableableRules).toEqual(['no-console']);
  });

  it('auto-detects oxlint from a config file without prompting', async () => {
    // An Oxlint config on disk is detected directly, so no linter prompt shows.
    writeFileSync(join(workDir, '.oxlintrc.json'), '{}\n');

    const result = init({ input, output, verbose: false });

    await waitForText('command should I run');
    press('return'); // accept the default lint command

    await waitForText('Ignore lint warnings?');
    press('return');

    await waitForText('monorepo mode');
    press('return'); // initialValue: false (single root package)

    await waitForText('prefixed with');
    press('return');

    await waitForText('flagged if disabled');
    type('no-console');
    press('return');

    await waitForText('compare against');
    press('return');

    await waitForText('database file be stored');
    press('return');

    await result;

    const config = readConfig(join(workDir, 'legacy-lint.config.jsonc'));
    expect(config.linterType).toBe('oxlint');
    expect(output.buffer.join('')).not.toContain('Which linter do you use?');
  });

  it('defaults monorepo mode to on when a workspace is detected', async () => {
    // Overwrite the plain single-package manifest from beforeEach with a
    // workspace manypkg recognizes (a lockfile marker plus a named child
    // package), so getIsMonorepo reads tool.type !== 'root' and the confirm
    // prompt defaults to Yes. Accepting that default records monorepo: true.
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        private: true,
        workspaces: ['packages/*'],
      })
    );
    writeFileSync(join(workDir, 'package-lock.json'), '{}');
    mkdirSync(join(workDir, 'packages', 'a'), { recursive: true });
    writeFileSync(
      join(workDir, 'packages', 'a', 'package.json'),
      JSON.stringify({ name: 'a', version: '1.0.0' })
    );

    const result = init({ input, output, verbose: false });

    await waitForText('Which linter do you use?');
    press('return'); // ESLint

    await waitForText('command should I run');
    press('return'); // accept the default lint command

    await waitForText('Ignore lint warnings?');
    press('return');

    await waitForText('monorepo mode');
    press('return'); // initialValue: true (workspace detected)

    await waitForText('prefixed with');
    press('return');

    await waitForText('flagged if disabled');
    press('return'); // accept the empty default rules list

    await waitForText('compare against');
    press('return');

    await waitForText('database file be stored');
    press('return');

    await result;

    const config = readConfig(join(workDir, 'legacy-lint.config.jsonc'));
    // A detected workspace records a monorepoConfig (its presence is what enables
    // monorepo mode), seeded with an empty ignore list for the user to fill in.
    expect(config.monorepoConfig).toEqual({ ignorePackagePaths: [] });
  });

  it('rejects a non-existent compare branch and accepts it on retry', async () => {
    // First validation fails (branch missing), second succeeds.
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
    } as unknown as ReturnType<typeof spawnSync>);

    const result = init({ input, output, verbose: false });

    await waitForText('Which linter do you use?');
    press('return');

    await waitForText('command should I run');
    press('return'); // accept the default lint command

    await waitForText('Ignore lint warnings?');
    press('return');

    await waitForText('monorepo mode');
    press('return'); // initialValue: false (single root package)

    await waitForText('prefixed with');
    press('return');

    await waitForText('flagged if disabled');
    press('return'); // accept the empty default rules list

    await waitForText('compare against');
    type('feature-branch');
    press('return'); // first validation: branch does not exist

    await waitForText('Branch "feature-branch" does not exist');
    press('return'); // retry: validation now succeeds

    await waitForText('database file be stored');
    press('return');

    await result;

    const config = readConfig(join(workDir, 'legacy-lint.config.jsonc'));
    expect(config.compareBranch).toBe('feature-branch');
    // A blank free-text rules answer must record [] (not ['']) for the
    // non-disableable rules.
    expect(config.nonDisableableRules).toEqual([]);
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it('records a custom lint command split into command and args', async () => {
    const result = init({ input, output, verbose: false });

    await waitForText('Which linter do you use?');
    press('return'); // ESLint

    await waitForText('command should I run');
    type('pnpm exec eslint -f json');
    press('return');

    await waitForText('Ignore lint warnings?');
    press('return');

    await waitForText('monorepo mode');
    press('return'); // initialValue: false (single root package)

    await waitForText('prefixed with');
    press('return');

    await waitForText('flagged if disabled');
    press('return'); // accept the empty default rules list

    await waitForText('compare against');
    press('return');

    await waitForText('database file be stored');
    press('return');

    await result;

    const config = readConfig(join(workDir, 'legacy-lint.config.jsonc'));
    // The whitespace-separated command becomes { command, args }.
    expect(config.lintCommand).toEqual({
      command: 'pnpm',
      args: ['exec', 'eslint', '-f', 'json'],
    });
  });

  it('rejects a lint command with quoted args and accepts a corrected one', async () => {
    const result = init({ input, output, verbose: false });

    await waitForText('Which linter do you use?');
    press('return'); // ESLint

    await waitForText('command should I run');
    const rejected = 'eslint "src/**"';
    type(rejected);
    press('return'); // validation fails: the value contains a quote

    await waitForText('cannot contain quoted arguments');
    // The rejected value stays in the buffer, so clear it before retyping.
    backspace(rejected.length);
    type('eslint -f json');
    press('return');

    await waitForText('Ignore lint warnings?');
    press('return');

    await waitForText('monorepo mode');
    press('return'); // initialValue: false (single root package)

    await waitForText('prefixed with');
    press('return');

    await waitForText('flagged if disabled');
    press('return');

    await waitForText('compare against');
    press('return');

    await waitForText('database file be stored');
    press('return');

    await result;

    const config = readConfig(join(workDir, 'legacy-lint.config.jsonc'));
    expect(config.lintCommand).toEqual({
      command: 'eslint',
      args: ['-f', 'json'],
    });
  });

  it('exits without writing a config when the user cancels', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const result = init({ input, output, verbose: false });

    await waitForText('Which linter do you use?');
    press('escape');

    await expect(result).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(existsSync(join(workDir, 'legacy-lint.config.jsonc'))).toBe(false);
  });
});
