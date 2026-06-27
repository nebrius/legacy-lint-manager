import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRAGMA } from '../../types.js';

const INTEGRATION_DIR = import.meta.dirname;
const FIXTURES_DIR = join(INTEGRATION_DIR, 'fixtures');
const SOURCES_DIR = join(FIXTURES_DIR, 'legacy-sources');
// The work directory is gitignored (fixtures/.gitignore), so copying the
// pristine sources here and letting the command mutate them never dirties the
// repo.
const WORK_DIR = join(FIXTURES_DIR, 'work');
const WORK_SRC = join(WORK_DIR, 'src');
const WORKING_DB = join(WORK_DIR, 'lint-legacies.json');

const REPO_ROOT = join(INTEGRATION_DIR, '..', '..', '..');
const ESLINT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'eslint');
const OXLINT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'oxlint');

const CONSOLE_FILE = join(WORK_SRC, 'usesConsole.ts');
const DEBUGGER_FILE = join(WORK_SRC, 'usesDebugger.ts');
const REL_FILES = ['src/usesConsole.ts', 'src/usesDebugger.ts'];

// usesVar.ts holds a no-var warning (line 2) and a no-console error (line 3),
// so it exercises the warning-vs-error split that --ignore-warnings toggles.
const VAR_FILE = join(WORK_SRC, 'usesVar.ts');
const VAR_REL_FILES = ['src/usesVar.ts'];

// eslint/oxlint exit non-zero when lint errors exist, so execFileSync throws;
// the JSON we want is on the thrown error's stdout.
function runLinter(bin: string, args: string[]): string {
  try {
    return execFileSync(bin, args, { cwd: WORK_DIR, encoding: 'utf-8' });
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout !== 'string' || stdout.length === 0) {
      throw err;
    }
    return stdout;
  }
}

function runEslint(files: string[] = REL_FILES): string {
  return runLinter(ESLINT_BIN, ['--no-ignore', '--format=json', ...files]);
}

function runOxlint(files: string[] = REL_FILES): string {
  return runLinter(OXLINT_BIN, ['-f', 'json', ...files]);
}

// generateIds.ts holds a process-global Set that getIds() reads in full, and
// vitest shares the module instance across tests in this file. Resetting
// modules + dynamically importing gives each test a fresh idSet so the two runs
// don't bleed ids into each other's database.
async function loadCommand() {
  vi.resetModules();
  const mod = await import('../../legacy/legacyExistingErrors.js');
  return mod.legacyExistingErrors;
}

function readDatabase(): {
  ids: string[];
  ignoreWarnings?: boolean;
  nonDisableableRules?: string[];
} {
  return JSON.parse(readFileSync(WORKING_DB, 'utf-8')) as {
    ids: string[];
    ignoreWarnings?: boolean;
    nonDisableableRules?: string[];
  };
}

// True when the file has a legacy-disable comment for the given rule (matching
// either the eslint or oxlint comment form).
function hasLegacyComment(path: string, rule: string): boolean {
  const contents = readFileSync(path, 'utf-8');
  return new RegExp(
    `-disable-next-line ${rule} -- This lint error is legacied\\. DO NOT COPY \\(${rule}\\) [\\w-]{8}`
  ).test(contents);
}

// Pull the 8-char ids out of the legacy comments the command wrote.
function idsInFile(path: string): string[] {
  const ids: string[] = [];
  const re =
    /\((?:no-console|no-debugger|eslint\/no-(?:console|debugger))\) ([\w-]{8})$/gm;
  let match: RegExpExecArray | null;
  const contents = readFileSync(path, 'utf-8');
  while ((match = re.exec(contents)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

beforeEach(() => {
  rmSync(WORK_DIR, { recursive: true, force: true });
  cpSync(SOURCES_DIR, WORK_DIR, { recursive: true });
  // The database must exist with valid JSON before the command runs.
  writeFileSync(WORKING_DB, JSON.stringify({ ids: [] }));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(WORK_DIR, { recursive: true, force: true });
});

describe('legacy-errors (integration)', () => {
  it('legacies real ESLint errors and records their ids', async () => {
    const legacyExistingErrors = await loadCommand();
    const json = runEslint();

    await legacyExistingErrors(
      {
        pragma: DEFAULT_PRAGMA,
        databaseFile: WORKING_DB,
        rootDir: WORK_DIR,
        verbose: false,
        nonDisableableRules: undefined,
      },
      Readable.from([json])
    );

    expect(readFileSync(CONSOLE_FILE, 'utf-8')).toMatch(
      /\/\/ eslint-disable-next-line no-console -- This lint error is legacied\. DO NOT COPY \(no-console\) [\w-]{8}/
    );
    expect(readFileSync(DEBUGGER_FILE, 'utf-8')).toMatch(
      /\/\/ eslint-disable-next-line no-debugger -- This lint error is legacied\. DO NOT COPY \(no-debugger\) [\w-]{8}/
    );

    const fileIds = [...idsInFile(CONSOLE_FILE), ...idsInFile(DEBUGGER_FILE)];
    expect(fileIds).toHaveLength(2);
    expect(readDatabase().ids.sort()).toEqual([...fileIds].sort());
  });

  it('creates the database when it does not yet exist', async () => {
    // The command builds the database from scratch (createIfMissing: true), so
    // remove the file the beforeEach seeded to prove it is created here.
    rmSync(WORKING_DB, { force: true });
    const legacyExistingErrors = await loadCommand();
    const json = runEslint();

    await legacyExistingErrors(
      {
        pragma: DEFAULT_PRAGMA,
        databaseFile: WORKING_DB,
        rootDir: WORK_DIR,
        verbose: false,
        nonDisableableRules: undefined,
      },
      Readable.from([json])
    );

    const fileIds = [...idsInFile(CONSOLE_FILE), ...idsInFile(DEBUGGER_FILE)];
    expect(fileIds).toHaveLength(2);
    expect(readDatabase().ids.sort()).toEqual([...fileIds].sort());
  });

  it('legacies real Oxlint errors and records their ids', async () => {
    const legacyExistingErrors = await loadCommand();
    const json = runOxlint();

    // Oxlint emits filenames relative to its cwd, so the command's readFileSync
    // resolves them against the work directory only if that is the cwd.
    const originalCwd = process.cwd();
    process.chdir(WORK_DIR);
    try {
      await legacyExistingErrors(
        {
          pragma: DEFAULT_PRAGMA,
          databaseFile: WORKING_DB,
          rootDir: WORK_DIR,
          verbose: false,
          nonDisableableRules: undefined,
        },
        Readable.from([json])
      );
    } finally {
      process.chdir(originalCwd);
    }

    expect(readFileSync(CONSOLE_FILE, 'utf-8')).toMatch(
      /\/\/ oxlint-disable-next-line eslint\/no-console -- This lint error is legacied\. DO NOT COPY \(eslint\/no-console\) [\w-]{8}/
    );
    expect(readFileSync(DEBUGGER_FILE, 'utf-8')).toMatch(
      /\/\/ oxlint-disable-next-line eslint\/no-debugger -- This lint error is legacied\. DO NOT COPY \(eslint\/no-debugger\) [\w-]{8}/
    );

    const fileIds = [...idsInFile(CONSOLE_FILE), ...idsInFile(DEBUGGER_FILE)];
    expect(fileIds).toHaveLength(2);
    expect(readDatabase().ids.sort()).toEqual([...fileIds].sort());
  });

  it('legacies an ESLint warning when ignoreWarnings is not set (default false)', async () => {
    const legacyExistingErrors = await loadCommand();
    const json = runEslint(VAR_REL_FILES);

    await legacyExistingErrors(
      {
        pragma: DEFAULT_PRAGMA,
        databaseFile: WORKING_DB,
        rootDir: WORK_DIR,
        verbose: false,
        nonDisableableRules: undefined,
      },
      Readable.from([json])
    );

    // Both the no-var warning and the no-console error get legacied, and the
    // database records the resolved default.
    expect(hasLegacyComment(VAR_FILE, 'no-var')).toBe(true);
    expect(hasLegacyComment(VAR_FILE, 'no-console')).toBe(true);
    expect(readDatabase().ignoreWarnings).toBe(false);
  });

  it('does not legacy an ESLint warning when ignoreWarnings is true', async () => {
    const legacyExistingErrors = await loadCommand();
    const json = runEslint(VAR_REL_FILES);

    await legacyExistingErrors(
      {
        pragma: DEFAULT_PRAGMA,
        databaseFile: WORKING_DB,
        rootDir: WORK_DIR,
        verbose: false,
        ignoreWarnings: true,
        nonDisableableRules: undefined,
      },
      Readable.from([json])
    );

    // The no-console error is still legacied; the no-var warning is skipped.
    expect(hasLegacyComment(VAR_FILE, 'no-console')).toBe(true);
    expect(hasLegacyComment(VAR_FILE, 'no-var')).toBe(false);
    expect(readDatabase().ignoreWarnings).toBe(true);
  });

  it('uses the database ignoreWarnings value when the flag is omitted', async () => {
    // Pre-seed the database with ignoreWarnings: true; running without the flag
    // must honor the stored value rather than resetting it to the default.
    writeFileSync(
      WORKING_DB,
      JSON.stringify({ ids: [], ignoreWarnings: true })
    );
    const legacyExistingErrors = await loadCommand();
    const json = runEslint(VAR_REL_FILES);

    await legacyExistingErrors(
      {
        pragma: DEFAULT_PRAGMA,
        databaseFile: WORKING_DB,
        rootDir: WORK_DIR,
        verbose: false,
        nonDisableableRules: undefined,
      },
      Readable.from([json])
    );

    expect(hasLegacyComment(VAR_FILE, 'no-console')).toBe(true);
    expect(hasLegacyComment(VAR_FILE, 'no-var')).toBe(false);
    expect(readDatabase().ignoreWarnings).toBe(true);
  });

  it('does not legacy an Oxlint warning when ignoreWarnings is true', async () => {
    const legacyExistingErrors = await loadCommand();
    const json = runOxlint(VAR_REL_FILES);

    const originalCwd = process.cwd();
    process.chdir(WORK_DIR);
    try {
      await legacyExistingErrors(
        {
          pragma: DEFAULT_PRAGMA,
          databaseFile: WORKING_DB,
          rootDir: WORK_DIR,
          verbose: false,
          ignoreWarnings: true,
          nonDisableableRules: undefined,
        },
        Readable.from([json])
      );
    } finally {
      process.chdir(originalCwd);
    }

    expect(hasLegacyComment(VAR_FILE, 'eslint/no-console')).toBe(true);
    expect(hasLegacyComment(VAR_FILE, 'eslint/no-var')).toBe(false);
    expect(readDatabase().ignoreWarnings).toBe(true);
  });

  it('persists the nonDisableableRules passed via the flag to the database', async () => {
    const legacyExistingErrors = await loadCommand();
    const json = runEslint();

    await legacyExistingErrors(
      {
        pragma: DEFAULT_PRAGMA,
        databaseFile: WORKING_DB,
        rootDir: WORK_DIR,
        verbose: false,
        nonDisableableRules: ['no-console', 'no-debugger'],
      },
      Readable.from([json])
    );

    expect(readDatabase().nonDisableableRules).toEqual([
      'no-console',
      'no-debugger',
    ]);
  });

  it('uses the database nonDisableableRules value when the flag is omitted', async () => {
    // Pre-seed the database with nonDisableableRules; running without the flag
    // must honor the stored value rather than resetting it to the default.
    writeFileSync(
      WORKING_DB,
      JSON.stringify({ ids: [], nonDisableableRules: ['no-console'] })
    );
    const legacyExistingErrors = await loadCommand();
    const json = runEslint();

    await legacyExistingErrors(
      {
        pragma: DEFAULT_PRAGMA,
        databaseFile: WORKING_DB,
        rootDir: WORK_DIR,
        verbose: false,
        nonDisableableRules: undefined,
      },
      Readable.from([json])
    );

    expect(readDatabase().nonDisableableRules).toEqual(['no-console']);
  });
});
