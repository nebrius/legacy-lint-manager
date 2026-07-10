import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRAGMA, ID_LENGTH } from '../../util/constants.js';
import { makeId } from '../helpers/ids.js';

const INTEGRATION_DIR = import.meta.dirname;
const FIXTURES_DIR = join(INTEGRATION_DIR, 'fixtures');
const SOURCES_DIR = join(FIXTURES_DIR, 'legacy-sources');
// The work directory is gitignored (fixtures/.gitignore), so copying the
// pristine sources here and letting the command mutate them never dirties the
// repo.
const WORK_DIR = join(FIXTURES_DIR, 'work');
const WORK_SRC = join(WORK_DIR, 'src');
const CONFIG_FILE = join(WORK_DIR, 'legacy-lint.config.jsonc');
const WORKING_DATA = join(WORK_DIR, 'legacy-lint.data.json');

const REPO_ROOT = join(INTEGRATION_DIR, '..', '..', '..');
const ESLINT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'eslint');
const OXLINT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'oxlint');

// Regex fragment matching an id of the configured length, shared by every
// assertion below so they track ID_LENGTH rather than hard-coding it.
const ID_PATTERN = `[\\w-]{${ID_LENGTH.toString()}}`;

const CONSOLE_FILE = join(WORK_SRC, 'usesConsole.ts');
const DEBUGGER_FILE = join(WORK_SRC, 'usesDebugger.ts');
const REL_FILES = ['src/usesConsole.ts', 'src/usesDebugger.ts'];

// usesVar.ts holds a no-var warning (line 2) and a no-console error (line 3),
// so it exercises the warning-vs-error split that ignoreWarnings toggles.
const VAR_FILE = join(WORK_SRC, 'usesVar.ts');
const VAR_REL_FILES = ['src/usesVar.ts'];

// The command derives its root dir from the git repo containing the config, and
// then scans that whole tree to rebuild the database. Making WORK_DIR its own
// repo scopes getRepoRoot/getFileList to just the copied sources — otherwise the
// root resolves to this tool's own repo and picks up unrelated fixtures.
function git(args: string[]) {
  execFileSync('git', args, { cwd: WORK_DIR, stdio: 'pipe' });
}

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

// Write a config file pointing at the work-dir data file. databaseFile is an
// absolute path so readDatabase resolves it regardless of the process cwd.
function writeConfig(ignoreWarnings = false, linterType = 'eslint') {
  writeFileSync(
    CONFIG_FILE,
    JSON.stringify({
      ignoreWarnings,
      pragma: DEFAULT_PRAGMA,
      databaseFile: WORKING_DATA,
      nonDisableableRules: [],
      compareBranch: 'main',
      linterType,
    })
  );
}

// vitest shares module instances across tests in this file. Resetting modules +
// dynamically importing gives each test a freshly-imported command, keeping any
// module-level state (e.g. nanoid) from bleeding between cases.
async function loadCommand() {
  vi.resetModules();
  const mod = await import('../../legacy/legacyExistingErrors.js');
  return mod.legacyExistingErrors;
}

// The data file is now an array of [id, rules] tuples.
function readData(): [string, string[]][] {
  return JSON.parse(readFileSync(WORKING_DATA, 'utf-8')) as [
    string,
    string[],
  ][];
}

// True when the file has a legacy-disable comment for the given rule (matching
// either the eslint or oxlint comment form).
function hasLegacyComment(path: string, rule: string): boolean {
  const contents = readFileSync(path, 'utf-8');
  return new RegExp(
    `-disable-next-line ${rule} -- This lint error is legacied\\. DO NOT COPY \\(${rule}\\) ${ID_PATTERN}`
  ).test(contents);
}

// Pull the ids out of the legacy comments the command wrote.
function idsInFile(path: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(
    `\\((?:no-console|no-debugger|eslint/no-(?:console|debugger))\\) (${ID_PATTERN})$`,
    'gm'
  );
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
  // Initialize a git repo in the work dir so getRepoRoot resolves here (rather
  // than to this tool's repo) and getFileList only scans the copied sources.
  // No commit is needed — the command only cares that a `.git` dir exists.
  git(['init']);
  // The data file must exist with valid JSON before the command runs; the
  // config file points at it. Tests override the config via writeConfig().
  writeFileSync(WORKING_DATA, JSON.stringify([]));
  writeConfig();
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
      { config: CONFIG_FILE, verbose: false },
      Readable.from([json])
    );

    expect(readFileSync(CONSOLE_FILE, 'utf-8')).toMatch(
      new RegExp(
        `// eslint-disable-next-line no-console -- This lint error is legacied\\. DO NOT COPY \\(no-console\\) ${ID_PATTERN}`
      )
    );
    expect(readFileSync(DEBUGGER_FILE, 'utf-8')).toMatch(
      new RegExp(
        `// eslint-disable-next-line no-debugger -- This lint error is legacied\\. DO NOT COPY \\(no-debugger\\) ${ID_PATTERN}`
      )
    );

    const fileIds = [...idsInFile(CONSOLE_FILE), ...idsInFile(DEBUGGER_FILE)];
    expect(fileIds).toHaveLength(2);
    const data = readData();
    expect(data.map(([id]) => id).sort()).toEqual([...fileIds].sort());
    // Each recorded id carries the rule its comment legacied.
    expect(new Map(data)).toEqual(
      new Map([
        [idsInFile(CONSOLE_FILE)[0], ['no-console']],
        [idsInFile(DEBUGGER_FILE)[0], ['no-debugger']],
      ])
    );
  });

  it('legacies real Oxlint errors and records their ids', async () => {
    writeConfig(false, 'oxlint');
    const legacyExistingErrors = await loadCommand();
    const json = runOxlint();

    // Oxlint emits filenames relative to its cwd, so the command's readFileSync
    // resolves them against the work directory only if that is the cwd.
    const originalCwd = process.cwd();
    process.chdir(WORK_DIR);
    try {
      await legacyExistingErrors(
        { config: CONFIG_FILE, verbose: false },
        Readable.from([json])
      );
    } finally {
      process.chdir(originalCwd);
    }

    expect(readFileSync(CONSOLE_FILE, 'utf-8')).toMatch(
      new RegExp(
        `// oxlint-disable-next-line eslint/no-console -- This lint error is legacied\\. DO NOT COPY \\(eslint/no-console\\) ${ID_PATTERN}`
      )
    );
    expect(readFileSync(DEBUGGER_FILE, 'utf-8')).toMatch(
      new RegExp(
        `// oxlint-disable-next-line eslint/no-debugger -- This lint error is legacied\\. DO NOT COPY \\(eslint/no-debugger\\) ${ID_PATTERN}`
      )
    );

    const fileIds = [...idsInFile(CONSOLE_FILE), ...idsInFile(DEBUGGER_FILE)];
    expect(fileIds).toHaveLength(2);
    const data = readData();
    expect(data.map(([id]) => id).sort()).toEqual([...fileIds].sort());
    // Oxlint reports rules under the `eslint/` prefix, so that is what is recorded.
    expect(new Map(data)).toEqual(
      new Map([
        [idsInFile(CONSOLE_FILE)[0], ['eslint/no-console']],
        [idsInFile(DEBUGGER_FILE)[0], ['eslint/no-debugger']],
      ])
    );
  });

  it('legacies an ESLint warning when the config sets ignoreWarnings false', async () => {
    writeConfig(false);
    const legacyExistingErrors = await loadCommand();
    const json = runEslint(VAR_REL_FILES);

    await legacyExistingErrors(
      { config: CONFIG_FILE, verbose: false },
      Readable.from([json])
    );

    // Both the no-var warning and the no-console error get legacied.
    expect(hasLegacyComment(VAR_FILE, 'no-var')).toBe(true);
    expect(hasLegacyComment(VAR_FILE, 'no-console')).toBe(true);
  });

  it('does not legacy an ESLint warning when the config sets ignoreWarnings true', async () => {
    writeConfig(true);
    const legacyExistingErrors = await loadCommand();
    const json = runEslint(VAR_REL_FILES);

    await legacyExistingErrors(
      { config: CONFIG_FILE, verbose: false },
      Readable.from([json])
    );

    // The no-console error is still legacied; the no-var warning is skipped.
    expect(hasLegacyComment(VAR_FILE, 'no-console')).toBe(true);
    expect(hasLegacyComment(VAR_FILE, 'no-var')).toBe(false);
  });

  it('does not legacy an Oxlint warning when the config sets ignoreWarnings true', async () => {
    writeConfig(true, 'oxlint');
    const legacyExistingErrors = await loadCommand();
    const json = runOxlint(VAR_REL_FILES);

    const originalCwd = process.cwd();
    process.chdir(WORK_DIR);
    try {
      await legacyExistingErrors(
        { config: CONFIG_FILE, verbose: false },
        Readable.from([json])
      );
    } finally {
      process.chdir(originalCwd);
    }

    expect(hasLegacyComment(VAR_FILE, 'eslint/no-console')).toBe(true);
    expect(hasLegacyComment(VAR_FILE, 'eslint/no-var')).toBe(false);
  });

  it('skips a file with a malformed legacy comment and aborts before writing the database', async () => {
    // The no-debugger disable on line 2 is a legacy comment with a 5-char id
    // (must be ID_LENGTH), so it is malformed. It sits immediately before the no-console
    // error on line 3 but disables an unrelated rule, so eslint still reports
    // the error and addLegacyStatements hits the malformed comment while merging.
    const MALFORMED_FILE = join(WORK_SRC, 'usesMalformed.ts');
    const source = [
      'export function logSomething(): void {',
      `  // eslint-disable-next-line no-debugger -- ${DEFAULT_PRAGMA} (no-debugger) short`,
      "  console.log('legacy console usage');",
      '}',
      '',
    ].join('\n');
    writeFileSync(MALFORMED_FILE, source);

    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const legacyExistingErrors = await loadCommand();
    const json = runEslint(['src/usesMalformed.ts']);

    // addLegacyStatements skips the file, but the database-rebuild pass re-scans
    // the tree, re-encounters the malformed comment, and aborts the whole run so
    // a partial/incorrect database is never written.
    await expect(
      legacyExistingErrors(
        { config: CONFIG_FILE, verbose: false },
        Readable.from([json])
      )
    ).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);

    // The file is skipped, so it is left byte-for-byte unchanged on disk...
    expect(readFileSync(MALFORMED_FILE, 'utf-8')).toBe(source);
    // ...the malformed comment is reported...
    expect(
      errorSpy.mock.calls.some(([msg]) =>
        String(msg).includes('Malformed legacy comment:')
      )
    ).toBe(true);
    // ...and the rebuild pass announces why it bailed.
    expect(
      errorSpy.mock.calls.some(([msg]) =>
        String(msg).includes('Parse errors found')
      )
    ).toBe(true);
  });

  it('preserves previously-legacied statements from files without new errors on a re-run', async () => {
    // First run legacies only the console file, recording its id.
    let legacyExistingErrors = await loadCommand();
    await legacyExistingErrors(
      { config: CONFIG_FILE, verbose: false },
      Readable.from([runEslint(['src/usesConsole.ts'])])
    );
    const firstData = readData();
    expect(firstData).toHaveLength(1);
    const consoleId = firstData[0][0];

    // Second run legacies only the debugger file. usesConsole.ts has no new
    // error this time, so it is never rewritten — but its previously-legacied
    // statement must survive in the rebuilt database rather than being dropped.
    legacyExistingErrors = await loadCommand();
    await legacyExistingErrors(
      { config: CONFIG_FILE, verbose: false },
      Readable.from([runEslint(['src/usesDebugger.ts'])])
    );

    const debuggerId = idsInFile(DEBUGGER_FILE)[0];
    expect(new Map(readData())).toEqual(
      new Map([
        [consoleId, ['no-console']],
        [debuggerId, ['no-debugger']],
      ])
    );
  });

  it('is idempotent when re-run with no new errors', async () => {
    let legacyExistingErrors = await loadCommand();
    await legacyExistingErrors(
      { config: CONFIG_FILE, verbose: false },
      Readable.from([runEslint()])
    );
    const dataAfterFirstRun = readData();
    const consoleAfterFirstRun = readFileSync(CONSOLE_FILE, 'utf-8');
    const debuggerAfterFirstRun = readFileSync(DEBUGGER_FILE, 'utf-8');

    // Re-run with empty lint output: nothing new to legacy, so no file changes,
    // and the database rebuilt from the existing comments comes back identical.
    legacyExistingErrors = await loadCommand();
    await legacyExistingErrors(
      { config: CONFIG_FILE, verbose: false },
      Readable.from(['[]'])
    );

    expect(readData()).toEqual(dataAfterFirstRun);
    expect(readFileSync(CONSOLE_FILE, 'utf-8')).toBe(consoleAfterFirstRun);
    expect(readFileSync(DEBUGGER_FILE, 'utf-8')).toBe(debuggerAfterFirstRun);
  });

  it('resolves a relative config path against the current working directory', async () => {
    const legacyExistingErrors = await loadCommand();
    const json = runEslint(['src/usesConsole.ts']);

    // Passing the config as a bare filename forces the relative-path branch,
    // which resolves it against cwd — so the command must run from the work dir.
    const originalCwd = process.cwd();
    process.chdir(WORK_DIR);
    try {
      await legacyExistingErrors(
        { config: basename(CONFIG_FILE), verbose: false },
        Readable.from([json])
      );
    } finally {
      process.chdir(originalCwd);
    }

    // The relative config resolved correctly, so the error was legacied and
    // recorded just as with an absolute path.
    expect(hasLegacyComment(CONSOLE_FILE, 'no-console')).toBe(true);
    expect(readData()).toHaveLength(1);
  });

  it('aborts when the codebase already contains a duplicate legacy id', async () => {
    // Two well-formed legacy comments sharing one id. parseComments accepts each
    // in isolation; the collision only surfaces when buildDatabase folds them
    // into a single database, which must abort the run.
    const sharedId = makeId('dupe');
    writeFileSync(
      join(WORK_SRC, 'dupeA.ts'),
      `// eslint-disable-next-line no-console -- ${DEFAULT_PRAGMA} (no-console) ${sharedId}\nconsole.log('a');\n`
    );
    writeFileSync(
      join(WORK_SRC, 'dupeB.ts'),
      `// eslint-disable-next-line no-debugger -- ${DEFAULT_PRAGMA} (no-debugger) ${sharedId}\ndebugger;\n`
    );

    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const legacyExistingErrors = await loadCommand();

    await expect(
      legacyExistingErrors(
        { config: CONFIG_FILE, verbose: false },
        Readable.from(['[]'])
      )
    ).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(
      errorSpy.mock.calls.some(([msg]) =>
        String(msg).includes('Duplicate ID errors found')
      )
    ).toBe(true);
  });
});
