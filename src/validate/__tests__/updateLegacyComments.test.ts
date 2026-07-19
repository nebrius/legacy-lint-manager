import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_ID_BASE, makeId } from '../../__tests__/helpers/ids.js';
import { getFileComments } from '../../util/comments.js';
import { DEFAULT_PRAGMA } from '../../util/constants.js';
import { parseDisableComment } from '../../util/parseDisableComment.js';
import type { LegacyComment, ValidationError } from '../../util/types.js';
import {
  doesLegacyCommentNeedUpdate,
  updateLegacyComments,
} from '../updateLegacyComments.js';

// updateLegacyComments splices real files at the indices the parse layer
// computed, so these tests run the genuine pipeline over real files in a temp
// dir: write the source, parse it with getFileComments + parseDisableComment
// (in update mode, like validate --update does), apply the update, and assert
// on the exact resulting file text. The pid keeps parallel vitest workers from
// colliding on the same temp dir.
const DIR = join(
  tmpdir(),
  `legacy-lint-update-comments-${process.pid.toString()}`
);

const ID = makeId(DEFAULT_ID_BASE);
const ID_B = makeId('secondcmt');

function writeFixture(name: string, lines: string[]): string {
  mkdirSync(DIR, { recursive: true });
  const filePath = join(DIR, name);
  writeFileSync(filePath, lines.join('\n'));
  return filePath;
}

// Parse a file the way validate does in update mode, returning its legacy
// comments.
function parseLegacyComments(filePath: string): LegacyComment[] {
  const validationErrors: ValidationError[] = [];
  const { comments } = getFileComments({
    filePath,
    fileContents: readFileSync(filePath, 'utf-8'),
    validationErrors,
  });
  const legacyComments: LegacyComment[] = [];
  for (const comment of comments) {
    const parsed = parseDisableComment({
      comment,
      pragma: DEFAULT_PRAGMA,
      validationErrors,
      errorOnUnusedRules: false,
    });
    if (parsed?.type === 'legacy') {
      legacyComments.push(parsed);
    }
  }
  expect(validationErrors).toEqual([]);
  return legacyComments;
}

// Runs the real pipeline over the given files, applies updateLegacyComments,
// and returns each file's resulting contents.
function runUpdate(filePaths: string[]): string[] {
  const legacyComments = filePaths.flatMap((filePath) =>
    parseLegacyComments(filePath)
  );
  updateLegacyComments({ legacyComments });
  return filePaths.map((filePath) => readFileSync(filePath, 'utf-8'));
}

// A generated legacy line: `disableRules` is what the directive disables,
// `legacyRules` is what the pragma's parens list claims to legacy.
function legacyLine(disableRules: string, legacyRules: string, id = ID) {
  return `  // eslint-disable-next-line ${disableRules} -- ${DEFAULT_PRAGMA} (${legacyRules}) ${id}`;
}

describe('doesLegacyCommentNeedUpdate', () => {
  afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  it('is true when the legacy list names a rule no longer in the disable list', () => {
    const filePath = writeFixture('a.ts', [
      legacyLine('no-console', 'no-console, no-debugger'),
      "  console.log('x');",
      '',
    ]);
    expect(doesLegacyCommentNeedUpdate(parseLegacyComments(filePath)[0])).toBe(
      true
    );
  });

  it('is true when no legacied rules remain', () => {
    const filePath = writeFixture('a.ts', [
      legacyLine('no-alert', 'no-console'),
      '  alert(1);',
      '',
    ]);
    expect(doesLegacyCommentNeedUpdate(parseLegacyComments(filePath)[0])).toBe(
      true
    );
  });

  it('is false for a comment whose legacy list matches the disable list', () => {
    const filePath = writeFixture('a.ts', [
      legacyLine('no-console', 'no-console'),
      "  console.log('x');",
      '',
    ]);
    expect(doesLegacyCommentNeedUpdate(parseLegacyComments(filePath)[0])).toBe(
      false
    );
  });
});

describe('updateLegacyComments', () => {
  afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  it('prunes an unused rule from the legacy list, leaving the rest of the file untouched', () => {
    const filePath = writeFixture('a.ts', [
      'export function f(): void {',
      legacyLine('no-console', 'no-console, no-debugger'),
      "  console.log('x');",
      '}',
      '',
    ]);

    const [contents] = runUpdate([filePath]);

    expect(contents).toBe(
      [
        'export function f(): void {',
        legacyLine('no-console', 'no-console'),
        "  console.log('x');",
        '}',
        '',
      ].join('\n')
    );
  });

  it('keeps non-adjacent surviving rules in their original order', () => {
    const filePath = writeFixture('a.ts', [
      legacyLine('no-alert, no-debugger', 'no-alert, no-console, no-debugger'),
      '  alert(1);',
      '',
    ]);

    const [contents] = runUpdate([filePath]);

    expect(contents).toBe(
      [
        legacyLine('no-alert, no-debugger', 'no-alert, no-debugger'),
        '  alert(1);',
        '',
      ].join('\n')
    );
  });

  it('removes the whole legacy portion when no legacied rules remain, without trailing whitespace', () => {
    const filePath = writeFixture('a.ts', [
      legacyLine('no-alert', 'no-console'),
      '  alert(1);',
      '',
    ]);

    const [contents] = runUpdate([filePath]);

    expect(contents).toBe(
      ['  // eslint-disable-next-line no-alert', '  alert(1);', ''].join('\n')
    );
  });

  it('removes the legacy portion of a comment with a hand-emptied `()` list', () => {
    const filePath = writeFixture('a.ts', [
      `  // eslint-disable-next-line no-alert -- ${DEFAULT_PRAGMA} () ${ID}`,
      '  alert(1);',
      '',
    ]);

    const [contents] = runUpdate([filePath]);

    expect(contents).toBe(
      ['  // eslint-disable-next-line no-alert', '  alert(1);', ''].join('\n')
    );
  });

  it('prunes inside a JSX block comment, preserving the closing tokens', () => {
    const filePath = writeFixture('app.tsx', [
      'export function App() {',
      '  return (',
      '    <div>',
      `      {/* eslint-disable-next-line no-console -- ${DEFAULT_PRAGMA} (no-console, no-debugger) ${ID} */}`,
      "      <span onClick={() => console.log('x')} />",
      '    </div>',
      '  );',
      '}',
      '',
    ]);

    const [contents] = runUpdate([filePath]);

    expect(contents).toContain(
      `      {/* eslint-disable-next-line no-console -- ${DEFAULT_PRAGMA} (no-console) ${ID} */}`
    );
  });

  it('removes the legacy portion of a JSX block comment, preserving the closing tokens', () => {
    const filePath = writeFixture('app.tsx', [
      'export function App() {',
      '  return (',
      '    <div>',
      `      {/* eslint-disable-next-line no-alert -- ${DEFAULT_PRAGMA} (no-console) ${ID} */}`,
      '      <span onClick={() => alert(1)} />',
      '    </div>',
      '  );',
      '}',
      '',
    ]);

    const [contents] = runUpdate([filePath]);

    expect(contents).toContain(
      '      {/* eslint-disable-next-line no-alert */}'
    );
  });

  it('updates multiple comments in the same file without invalidating their indices', () => {
    // The bottom-up splice order matters here: pruning the first comment
    // shortens the file, so the second comment's indices are only valid if it
    // is spliced first.
    const filePath = writeFixture('a.ts', [
      legacyLine('no-console', 'no-console, no-debugger'),
      "  console.log('x');",
      legacyLine('no-alert', 'no-console', ID_B),
      '  alert(1);',
      '',
    ]);

    const [contents] = runUpdate([filePath]);

    expect(contents).toBe(
      [
        legacyLine('no-console', 'no-console'),
        "  console.log('x');",
        '  // eslint-disable-next-line no-alert',
        '  alert(1);',
        '',
      ].join('\n')
    );
  });

  it('leaves a healthy comment in the same file untouched', () => {
    const filePath = writeFixture('a.ts', [
      legacyLine('no-console', 'no-console'),
      "  console.log('x');",
      legacyLine('no-debugger', 'no-debugger, no-console', ID_B),
      '  debugger;',
      '',
    ]);

    const [contents] = runUpdate([filePath]);

    expect(contents).toBe(
      [
        legacyLine('no-console', 'no-console'),
        "  console.log('x');",
        legacyLine('no-debugger', 'no-debugger', ID_B),
        '  debugger;',
        '',
      ].join('\n')
    );
  });

  it('updates multiple files independently and leaves files with nothing to update untouched', () => {
    const pruneFile = writeFixture('prune.ts', [
      legacyLine('no-console', 'no-console, no-debugger'),
      "  console.log('x');",
      '',
    ]);
    const removeFile = writeFixture('remove.ts', [
      legacyLine('no-alert', 'no-console', ID_B),
      '  alert(1);',
      '',
    ]);
    const healthyLines = [
      legacyLine('no-console', 'no-console'),
      "  console.log('x');",
      '',
    ];
    const healthyFile = writeFixture('healthy.ts', healthyLines);

    const [pruned, removed, healthy] = runUpdate([
      pruneFile,
      removeFile,
      healthyFile,
    ]);

    expect(pruned).toBe(
      [legacyLine('no-console', 'no-console'), "  console.log('x');", ''].join(
        '\n'
      )
    );
    expect(removed).toBe(
      ['  // eslint-disable-next-line no-alert', '  alert(1);', ''].join('\n')
    );
    expect(healthy).toBe(healthyLines.join('\n'));
  });
});
