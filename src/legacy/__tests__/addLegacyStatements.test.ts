import type { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFileComments } from '../../util/comments.js';
import { DEFAULT_PRAGMA } from '../../util/constants.js';
import { parseDisableComment } from '../../util/parseDisableComment.js';
import type { LintErrors } from '../../util/types.js';
import { addLegacyStatements } from '../addLegacyStatements.js';
import { getIds } from '../generateIds.js';

// nanoid is mocked so generated ids are deterministic (enabling exact-string
// assertions) and so we can deliberately force a collision to exercise the
// dedupe loop in generateId.
const nanoidMock = vi.fn<typeof nanoid>();
vi.mock('nanoid', () => ({ nanoid: () => nanoidMock() }));

const FILE = 'test.ts';
const JSX_FILE = 'test.tsx';
const ROOT = '/repo';

// The function under test keeps a module-level idSet to dedupe generated ids
// across calls; it persists for the whole test run. To keep that from coupling
// tests, the default nanoid mock is a single monotonic counter that never
// repeats a value across the run. Tests assert against the ids that were
// actually handed out (captured below) rather than hard-coding global counts.
let monotonic = 0;
function nextId() {
  monotonic++;
  return `id${monotonic.toString().padStart(6, '0')}`;
}

// The ids produced by the default generator during a single run() call, in
// order, so tests can assert exact output without depending on the global
// counter's value.
let issuedIds: string[] = [];

beforeEach(() => {
  nanoidMock.mockReset();
  issuedIds = [];
  nanoidMock.mockImplementation(() => {
    const id = nextId();
    issuedIds.push(id);
    return id;
  });
});

function makeLintErrors(
  type: LintErrors['type'],
  entries: Array<[number, string[]]>,
  filePath = FILE
): LintErrors {
  return { type, errors: new Map([[filePath, new Map(entries)]]) };
}

function runRaw({
  type = 'eslint',
  fileContents,
  entries,
  pragma = DEFAULT_PRAGMA,
  filePath = FILE,
  rootDir = ROOT,
}: {
  type?: LintErrors['type'];
  fileContents: string;
  entries: Array<[number, string[]]>;
  pragma?: string;
  filePath?: string;
  rootDir?: string;
}) {
  return addLegacyStatements({
    pragma,
    lintErrors: makeLintErrors(type, entries, filePath),
    fileContents,
    filePath,
    rootDir,
  });
}

// Most tests exercise the happy path, where the file is always rewritten, so
// they can treat the result as a plain string. addLegacyStatements only returns
// undefined when it skips a file for a malformed legacy comment; those tests use
// runRaw directly to observe that.
function run(args: Parameters<typeof runRaw>[0]): string {
  const result = runRaw(args);
  if (result === undefined) {
    throw new Error('Expected addLegacyStatements to return file contents');
  }
  return result;
}

describe('addLegacyStatements', () => {
  describe('net-new insertion', () => {
    it('inserts a disable comment on the line before a single JS-context error', () => {
      const result = run({
        fileContents: 'const a = 1;\nconst x = 2;',
        entries: [[1, ['no-magic-numbers']]],
      });
      expect(result.split('\n')).toEqual([
        'const a = 1;',
        `// eslint-disable-next-line no-magic-numbers -- ${DEFAULT_PRAGMA} (no-magic-numbers) ${issuedIds[0]}`,
        'const x = 2;',
      ]);
    });

    it('renders multiple rules comma-joined in both the combined and new-rules lists', () => {
      const result = run({
        fileContents: 'const a = 1;\nconst x = 2;',
        entries: [[1, ['no-magic-numbers', 'no-unused-vars']]],
      });
      expect(result.split('\n')[1]).toBe(
        `// eslint-disable-next-line no-magic-numbers, no-unused-vars -- ${DEFAULT_PRAGMA} (no-magic-numbers, no-unused-vars) ${issuedIds[0]}`
      );
    });

    it('uses the oxlint prefix when the lint error type is oxlint', () => {
      const result = run({
        type: 'oxlint',
        fileContents: 'const a = 1;\nconst x = 2;',
        entries: [[1, ['no-debugger']]],
      });
      expect(result.split('\n')[1]).toBe(
        `// oxlint-disable-next-line no-debugger -- ${DEFAULT_PRAGMA} (no-debugger) ${issuedIds[0]}`
      );
    });

    it('honors a non-default pragma verbatim with indentation', () => {
      const pragma = 'CUSTOM LEGACY PRAGMA';
      const result = run({
        fileContents: 'if (1) {\n  const a = 1;\n  const x = 2;\n}',
        entries: [[1, ['no-debugger']]],
        pragma,
      });
      expect(result.split('\n')[1]).toBe(
        `  // eslint-disable-next-line no-debugger -- ${pragma} (no-debugger) ${issuedIds[0]}`
      );
    });

    it('wraps the comment as a JSX expression in a JSX context', () => {
      // The error sits on the `{x}` child line, which getFileContexts reports
      // as a jsx-context line.
      const fileContents = `const a = (
  <div>
    {x}
  </div>
);`;
      const result = run({
        fileContents,
        entries: [[2, ['no-undef']]],
        filePath: JSX_FILE,
      });
      expect(result.split('\n')[2]).toBe(
        `    {/* eslint-disable-next-line no-undef -- ${DEFAULT_PRAGMA} (no-undef) ${issuedIds[0]} */}`
      );
    });

    it('uses a line comment for an error on an attribute line of a multi-line opening tag', () => {
      // The attribute region of an opening tag is js context, so the disable
      // must be a `//` comment — a `{/* */}` comment is a syntax error between
      // JSX attributes.
      const fileContents = `const a = (
  <Button
    onClick={fn}
  >
    Reset
  </Button>
);`;
      const result = run({
        fileContents,
        entries: [[2, ['no-undef']]],
        filePath: JSX_FILE,
      });
      expect(result.split('\n')[2]).toBe(
        `    // eslint-disable-next-line no-undef -- ${DEFAULT_PRAGMA} (no-undef) ${issuedIds[0]}`
      );
    });
  });

  describe('reverse-iteration ordering', () => {
    it('inserts comments for multiple errors without displacing earlier lines', () => {
      const result = run({
        fileContents: 'const a = 1;\nconst b = 2;\nconst c = 3;',
        entries: [
          [0, ['rule-a']],
          [2, ['rule-c']],
        ],
      });
      // Errors are processed in descending line order, so line 2's comment is
      // generated first (issuedIds[0]) and line 0's second (issuedIds[1]).
      expect(result.split('\n')).toEqual([
        `// eslint-disable-next-line rule-a -- ${DEFAULT_PRAGMA} (rule-a) ${issuedIds[1]}`,
        'const a = 1;',
        'const b = 2;',
        `// eslint-disable-next-line rule-c -- ${DEFAULT_PRAGMA} (rule-c) ${issuedIds[0]}`,
        'const c = 3;',
      ]);
    });
  });

  describe('merge into an existing next-line comment', () => {
    it('reuses the legacy id and carries the previously-legacied rule into the parenthetical', () => {
      // Legacy ids must be unique per test: the function's module-level idSet
      // persists across the run and would otherwise regenerate a reused id that
      // was already issued elsewhere.
      const existing = `// eslint-disable-next-line old-rule -- ${DEFAULT_PRAGMA} (old-rule) keepid01`;
      const result = run({
        fileContents: `const a = 1;\n${existing}\nconst x = 2;`,
        entries: [[2, ['new-rule']]],
      });
      // The merged comment keeps the original id, so nanoid is never consumed.
      expect(nanoidMock).not.toHaveBeenCalled();
      // The parenthetical is the union of the newly-legacied rule and the
      // rule that was already legacied; previously-legacied rules must not be
      // dropped from the tracked set on re-legacy.
      expect(result.split('\n')).toEqual([
        'const a = 1;',
        `// eslint-disable-next-line new-rule, old-rule -- ${DEFAULT_PRAGMA} (new-rule, old-rule) keepid01`,
        'const x = 2;',
      ]);
    });

    it('records the full union of legacied rules against the reused id in the ids map', () => {
      const existing = `// eslint-disable-next-line old-rule -- ${DEFAULT_PRAGMA} (old-rule) keepid20`;
      run({
        fileContents: `const a = 1;\n${existing}\nconst x = 2;`,
        entries: [[2, ['new-rule']]],
      });
      // The database entry for a merged legacy tracks every legacied rule (the
      // new lint error unioned with the previously-legacied rule), not just the
      // new one — otherwise re-legacying would silently drop the old rule from
      // the database.
      expect(getIds().get('keepid20')).toEqual(['new-rule', 'old-rule']);
    });

    it('dedupes a rule that already exists in the legacy comment', () => {
      const existing = `// eslint-disable-next-line shared, old-rule -- ${DEFAULT_PRAGMA} (shared, old-rule) keepid02`;
      const result = run({
        fileContents: `const a = 1;\n${existing}\nconst x = 2;`,
        entries: [[2, ['shared', 'new-rule']]],
      });
      // `shared` was already legacied, so re-legacying it is a no-op union; the
      // parenthetical stays the union of all legacied rules (shared already in
      // it, new-rule added, old-rule carried forward).
      expect(result.split('\n')[1]).toBe(
        `// eslint-disable-next-line shared, new-rule, old-rule -- ${DEFAULT_PRAGMA} (shared, new-rule, old-rule) keepid02`
      );
    });

    it('re-legacies a comment with a mix of legacied and non-legacied rules, preserving both sets', () => {
      // The genuine mixed case: the existing legacy comment's directive lists
      // `a, b` but only `b` is inside the parenthetical, so `b` is legacied and
      // `a` is a human-added rule the manager does not track. Re-legacying with
      // a new error `c` must add `c` to the legacied set, keep `b` legacied, and
      // leave `a` untouched as non-legacied.
      const existing = `// eslint-disable-next-line a, b -- ${DEFAULT_PRAGMA} (b) keepid09`;
      const result = run({
        fileContents: `const foo = 1;\n${existing}\nconst x = 2;`,
        entries: [[2, ['c']]],
      });
      expect(nanoidMock).not.toHaveBeenCalled();
      expect(result.split('\n')[1]).toBe(
        `// eslint-disable-next-line c, b, a -- ${DEFAULT_PRAGMA} (c, b) keepid09`
      );
    });

    it('converts a non-legacy disable comment, keeping its rule as non-legacied and dropping its explanation', () => {
      // A plain, human-authored disable comment whose explanation does not
      // match the pragma.
      const existing =
        '// eslint-disable-next-line old-rule -- because reasons';
      const result = run({
        fileContents: `const a = 1;\n${existing}\nconst x = 2;`,
        entries: [[2, ['new-rule']]],
      });
      // No legacy id to reuse, so a fresh id is generated.
      expect(nanoidMock).toHaveBeenCalledTimes(1);
      // `new-rule` is the newly-legacied rule (it lands in the parenthetical);
      // the human's pre-existing `old-rule` is preserved in the directive as a
      // non-legacied rule, so its suppression is not lost.
      //
      // The human explanation (`-- because reasons`) is intentionally dropped:
      // once a line is legacied, the pragma comment is a machine-owned
      // generated artifact parsed by a strict, whitespace-sensitive regex
      // (see parseDisableComment.ts), so there is no slot for arbitrary prose.
      // This drop is deliberate but temporary — TODO.md item 7 tracks lifting
      // such comments to a separate line above the legacy disable. Update this
      // test when that lands.
      expect(result.split('\n')[1]).toBe(
        `// eslint-disable-next-line new-rule, old-rule -- ${DEFAULT_PRAGMA} (new-rule) ${issuedIds[0]}`
      );
      expect(result).not.toContain('because reasons');
    });

    it('does not merge into a same-line disable comment, inserting a net-new comment instead', () => {
      // A same-line disable on the preceding line must not be treated as a
      // mergeable next-line comment.
      const result = run({
        fileContents:
          'const a = 1; // eslint-disable-line some-rule\nconst x = 2;',
        entries: [[1, ['new-rule']]],
      });
      expect(result.split('\n')).toEqual([
        'const a = 1; // eslint-disable-line some-rule',
        `// eslint-disable-next-line new-rule -- ${DEFAULT_PRAGMA} (new-rule) ${issuedIds[0]}`,
        'const x = 2;',
      ]);
    });

    it('does not merge into a block disable comment, inserting a net-new comment instead', () => {
      const result = run({
        fileContents: '/* eslint-disable some-rule */\nconst x = 2;',
        entries: [[1, ['new-rule']]],
      });
      expect(result.split('\n')).toEqual([
        '/* eslint-disable some-rule */',
        `// eslint-disable-next-line new-rule -- ${DEFAULT_PRAGMA} (new-rule) ${issuedIds[0]}`,
        'const x = 2;',
      ]);
    });

    it('merges an early line and inserts net-new on a later line without displacement', () => {
      // The realistic mix: a same-length merge into an existing legacy comment
      // on an early line, plus a length-changing net-new splice on a later
      // line. Reverse iteration processes the later (net-new) line first, so
      // the merge's line indices must not have shifted underneath it.
      const existing = `// eslint-disable-next-line old-rule -- ${DEFAULT_PRAGMA} (old-rule) keepid05`;
      const result = run({
        fileContents: `const a = 1;\n${existing}\nconst b = 2;\nconst c = 3;`,
        entries: [
          [2, ['new-rule']], // merges into the comment ending on line 1
          [3, ['rule-c']], // net-new, inserted before line 3
        ],
      });
      // The net-new comment is processed first and takes issuedIds[0]; the
      // merge reuses keepid05 and never consumes nanoid.
      expect(nanoidMock).toHaveBeenCalledTimes(1);
      expect(result.split('\n')).toEqual([
        'const a = 1;',
        `// eslint-disable-next-line new-rule, old-rule -- ${DEFAULT_PRAGMA} (new-rule, old-rule) keepid05`,
        'const b = 2;',
        `// eslint-disable-next-line rule-c -- ${DEFAULT_PRAGMA} (rule-c) ${issuedIds[0]}`,
        'const c = 3;',
      ]);
    });
  });

  describe('id collision guard', () => {
    it('regenerates the id when nanoid first returns an already-used value', () => {
      // First insertion consumes "dupe00id". The second insertion's first
      // nanoid call returns that same value, forcing the while loop to spin
      // again and take the unique "freshnew".
      nanoidMock
        .mockReturnValueOnce('dupe00id')
        .mockReturnValueOnce('dupe00id')
        .mockReturnValueOnce('freshnew');
      const result = run({
        fileContents: 'const a = 1;\nconst b = 2;\nconst c = 3;',
        entries: [
          [0, ['rule-a']],
          [2, ['rule-c']],
        ],
      });
      const lines = result.split('\n');
      // Reverse iteration: the line-2 error is processed first and takes
      // dupe00id (lines[3] after insertion); the line-0 error is processed
      // second, collides on dupe00id, and falls through to freshnew (lines[0]).
      expect(lines[3]).toContain('dupe00id');
      expect(lines[0]).toContain('freshnew');
      expect(nanoidMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('round-trips through parseDisableComment', () => {
    function parseGeneratedLine(fileContents: string, lineIndex: number) {
      const line = fileContents.split('\n')[lineIndex];
      const { comments } = getFileComments({
        filePath: FILE,
        fileContents: line,
      });
      return parseDisableComment({
        comment: comments[0],
        pragma: DEFAULT_PRAGMA,
        validationErrors: [],
      });
    }

    it('produces a net-new comment the parser reads back as a legacy comment', () => {
      const result = run({
        fileContents: 'const a = 1;\nconst x = 2;',
        entries: [[1, ['no-magic-numbers']]],
      });
      const parsed = parseGeneratedLine(result, 1);
      expect(parsed?.type === 'legacy' && parsed.legaciedRules).toEqual([
        'no-magic-numbers',
      ]);
      expect(parsed?.type === 'legacy' && parsed.id).toBe(issuedIds[0]);
    });

    it('produces a merged comment the parser reads back with the reused id', () => {
      const existing = `// eslint-disable-next-line old-rule -- ${DEFAULT_PRAGMA} (old-rule) keepid03`;
      const result = run({
        fileContents: `const a = 1;\n${existing}\nconst x = 2;`,
        entries: [[2, ['new-rule']]],
      });
      // The existing comment was fully legacied (`(old-rule)`), so re-legacying
      // with `new-rule` unions the two into the parenthetical. Both come back as
      // legaciedRules and nothing is non-legacied. The id is the reused legacy
      // id.
      const parsed = parseGeneratedLine(result, 1);
      expect(parsed?.type === 'legacy' && parsed.legaciedRules).toEqual([
        'new-rule',
        'old-rule',
      ]);
      expect(parsed?.type === 'legacy' && parsed.nonLegaciedRules).toEqual([]);
      expect(parsed?.type === 'legacy' && parsed.id).toBe('keepid03');
    });

    it('round-trips a re-legacied mixed comment back into the correct legacied/non-legacied buckets', () => {
      // Existing directive `a, b` with only `b` legacied; re-legacy adds `c`.
      // The regenerated comment must parse back with `c` and `b` legacied and
      // the human's `a` still non-legacied — the property the refactor fixed.
      const existing = `// eslint-disable-next-line a, b -- ${DEFAULT_PRAGMA} (b) keepid10`;
      const result = run({
        fileContents: `const foo = 1;\n${existing}\nconst x = 2;`,
        entries: [[2, ['c']]],
      });
      const parsed = parseGeneratedLine(result, 1);
      expect(parsed?.type === 'legacy' && parsed.legaciedRules).toEqual([
        'c',
        'b',
      ]);
      expect(parsed?.type === 'legacy' && parsed.nonLegaciedRules).toEqual([
        'a',
      ]);
      expect(parsed?.type === 'legacy' && parsed.id).toBe('keepid10');
    });
  });

  describe('malformed legacy comment', () => {
    // A next-line legacy comment whose id is 5 chars ("short") instead of the
    // required 8, so parseDisableComment records a validation error.
    const MALFORMED = `// eslint-disable-next-line old-rule -- ${DEFAULT_PRAGMA} (old-rule) short`;

    // Capture everything written to console.error (both printValidationErrors
    // and the skip-notice funnel through logging.error -> console.error).
    function captureErrors() {
      const messages: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((msg: string) => {
        messages.push(msg);
      });
      return messages;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns undefined and consumes no id when the legacy comment on the error line is malformed', () => {
      captureErrors();
      const result = runRaw({
        fileContents: `const a = 1;\n${MALFORMED}\nconst x = 2;`,
        entries: [[2, ['new-rule']]],
      });
      // The file is skipped, so the caller writes nothing, and we bail before
      // generating an id.
      expect(result).toBeUndefined();
      expect(nanoidMock).not.toHaveBeenCalled();
    });

    it('reports the malformed comment and a skip notice', () => {
      const messages = captureErrors();
      runRaw({
        fileContents: `const a = 1;\n${MALFORMED}\nconst x = 2;`,
        entries: [[2, ['new-rule']]],
      });
      // printValidationErrors prints the parser detail; the skip notice follows.
      expect(
        messages.some((m) => m.includes('Malformed legacy comment:'))
      ).toBe(true);
      expect(messages).toContain('Errors in this file will not be legacied');
    });

    it('skips the entire file, leaving valid errors on other lines un-legacied', () => {
      captureErrors();
      // Reverse iteration processes the line-3 error first (whose preceding
      // comment is malformed) and bails, so the line-0 error is never legacied.
      const result = runRaw({
        fileContents: `const a = 1;\nconst b = 2;\n${MALFORMED}\nconst c = 3;`,
        entries: [
          [0, ['rule-a']],
          [3, ['new-rule']],
        ],
      });
      expect(result).toBeUndefined();
      expect(nanoidMock).not.toHaveBeenCalled();
    });

    it('strips rootDir from the reported file path', () => {
      const messages = captureErrors();
      runRaw({
        fileContents: `const a = 1;\n${MALFORMED}\nconst x = 2;`,
        entries: [[2, ['new-rule']]],
        filePath: `${ROOT}/src/app.ts`,
        rootDir: ROOT,
      });
      // The header is the repo-relative path, with no trace of rootDir.
      expect(messages).toContain('src/app.ts:');
      expect(messages.some((m) => m.includes(ROOT))).toBe(false);
    });

    it('does not block legacying when a malformed legacy comment is not adjacent to an error line', () => {
      captureErrors();
      // The malformed comment sits on line 1, but the only error is on line 3,
      // so the merge branch (which checks line - 1) never inspects it and
      // legacying proceeds normally.
      const result = runRaw({
        fileContents: `const a = 1;\n${MALFORMED}\nconst b = 2;\nconst c = 3;`,
        entries: [[3, ['new-rule']]],
      });
      expect(result).toBeDefined();
      // The stray malformed comment is left untouched...
      expect(result).toContain(MALFORMED);
      // ...and the line-3 error is legacied as a net-new comment.
      expect(result).toContain(`new-rule -- ${DEFAULT_PRAGMA} (new-rule)`);
    });
  });
});
