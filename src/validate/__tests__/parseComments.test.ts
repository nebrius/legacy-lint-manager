import type * as NodeFs from 'node:fs';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRAGMA } from '../../util/constants.js';
import type { ValidationError } from '../../util/types.js';
import { parseComments } from '../parseComments.js';

// parseComments reads each file off disk and hands the contents to the real
// oxc-based comment parser, so we stub only readFileSync and let the genuine
// parsing/sorting logic run end-to-end (mirroring comments.test.ts).
vi.mock('node:fs', async (importActual) => ({
  ...(await importActual<typeof NodeFs>()),
  readFileSync: vi.fn(),
}));

const readFileSyncMock = vi.mocked(readFileSync);

// The message the disable-all guard records; kept in one place so the tests
// assert against the exact production string.
const DISABLE_ALL_MESSAGE =
  'Disabling all rules is not allowed because some rules are configured as non-disableable';

// Most tests only vary the sources and the non-disableable list. This wrapper
// wires readFileSync to serve the given path->contents map, fills the rest with
// inert defaults, and returns the parse result alongside the errors array it
// accumulated into.
function callParse({
  sources,
  nonDisableableRules = [],
  validationErrors = [],
  pragma = DEFAULT_PRAGMA,
}: {
  sources: Record<string, string>;
  nonDisableableRules?: string[];
  validationErrors?: ValidationError[];
  pragma?: string;
}) {
  // files is always derived from the sources keys below, so every read hits a
  // known entry.
  readFileSyncMock.mockImplementation(
    ((path: string): string => sources[path]) as typeof readFileSync
  );

  const result = parseComments({
    files: Object.keys(sources),
    nonDisableableRules,
    validationErrors,
    pragma,
  });
  return { ...result, validationErrors };
}

// A generated legacy directive: it legacies `rules` under `id` while the raw
// disable list stays `rules` too (the common case).
function legacyDirective(rules: string, id: string) {
  return `// eslint-disable-next-line ${rules} -- ${DEFAULT_PRAGMA} (${rules}) ${id}`;
}

describe('parseComments', () => {
  describe('disable-all guard', () => {
    it('records an error and skips a blanket disable when rules are non-disableable', () => {
      const { legacyComments, nonLegacyComments, validationErrors } = callParse(
        {
          sources: { 'a.ts': '// eslint-disable\n' },
          nonDisableableRules: ['no-console'],
        }
      );
      expect(validationErrors).toEqual([
        {
          message: DISABLE_ALL_MESSAGE,
          location: { file: 'a.ts', line: 0 },
        },
      ]);
      // The guard continues past the comment, so it never becomes a
      // legacy/non-legacy entry.
      expect(legacyComments).toEqual([]);
      expect(nonLegacyComments).toEqual([]);
    });

    it('reports the guard error on the line the blanket disable sits on', () => {
      const { validationErrors } = callParse({
        sources: { 'a.ts': 'const x = 1;\nconst y = 2;\n// eslint-disable\n' },
        nonDisableableRules: ['no-console'],
      });
      expect(validationErrors).toEqual([
        {
          message: DISABLE_ALL_MESSAGE,
          location: { file: 'a.ts', line: 2 },
        },
      ]);
    });

    it('allows a blanket disable when no rules are non-disableable', () => {
      const { nonLegacyComments, validationErrors } = callParse({
        sources: { 'a.ts': '// eslint-disable\n' },
        nonDisableableRules: [],
      });
      // With nothing marked non-disableable the blanket disable is a normal
      // non-legacy comment that disables every rule (an empty rule list).
      expect(validationErrors).toEqual([]);
      expect(nonLegacyComments).toEqual([
        {
          type: 'nonlegacy',
          file: 'a.ts',
          startLine: 0,
          endLine: 0,
          rules: [],
        },
      ]);
    });

    it('does not fire for a rule-specific disable of a non-disableable rule', () => {
      const { nonLegacyComments, validationErrors } = callParse({
        sources: { 'a.ts': '// eslint-disable-next-line no-console\n' },
        nonDisableableRules: ['no-console'],
      });
      // The guard only catches blanket disables. A named disable of a
      // non-disableable rule is caught later, in validateDisableComments, so
      // here it is collected untouched as a non-legacy comment.
      expect(validationErrors).toEqual([]);
      expect(nonLegacyComments).toEqual([
        {
          type: 'nonlegacy',
          file: 'a.ts',
          startLine: 0,
          endLine: 0,
          rules: ['no-console'],
        },
      ]);
    });

    it('rejects a blanket disable even when it carries a legacy pragma', () => {
      const { legacyComments, nonLegacyComments, validationErrors } = callParse(
        {
          sources: {
            'a.ts': `// eslint-disable -- ${DEFAULT_PRAGMA} (no-console) a1b2c3d4\n`,
          },
          nonDisableableRules: ['no-console'],
        }
      );
      // The empty rule list before the `--` makes this a disable-all, so the
      // guard fires before the pragma is ever parsed as a legacy comment.
      expect(validationErrors).toEqual([
        {
          message: DISABLE_ALL_MESSAGE,
          location: { file: 'a.ts', line: 0 },
        },
      ]);
      expect(legacyComments).toEqual([]);
      expect(nonLegacyComments).toEqual([]);
    });

    it('appends the guard error after any pre-existing errors', () => {
      const validationErrors: ValidationError[] = [
        { message: 'pre-existing', location: { file: 'x.ts', line: 9 } },
      ];
      callParse({
        sources: { 'a.ts': '// eslint-disable\n' },
        nonDisableableRules: ['no-console'],
        validationErrors,
      });
      expect(validationErrors).toEqual([
        { message: 'pre-existing', location: { file: 'x.ts', line: 9 } },
        {
          message: DISABLE_ALL_MESSAGE,
          location: { file: 'a.ts', line: 0 },
        },
      ]);
    });
  });

  describe('sorting comments into legacy and non-legacy buckets', () => {
    it('routes a legacy pragma to legacyComments and a plain disable to nonLegacyComments', () => {
      const { legacyComments, nonLegacyComments, validationErrors } = callParse(
        {
          sources: {
            'a.ts': `${legacyDirective('no-console', 'a1b2c3d4')}\n// eslint-disable-next-line no-debugger\n`,
          },
        }
      );
      expect(validationErrors).toEqual([]);
      expect(legacyComments).toEqual([
        {
          type: 'legacy',
          file: 'a.ts',
          startLine: 0,
          endLine: 0,
          legaciedRules: ['no-console'],
          nonLegaciedRules: [],
          id: 'a1b2c3d4',
        },
      ]);
      expect(nonLegacyComments).toEqual([
        {
          type: 'nonlegacy',
          file: 'a.ts',
          startLine: 1,
          endLine: 1,
          rules: ['no-debugger'],
        },
      ]);
    });
  });

  describe('legacy pragmas on non-next-line directives', () => {
    // The pragma is only valid on `*-disable-next-line` directives; carrying
    // it on a block or same-line disable would let a user widen a legacied
    // disable to cover new violations. Naming a rule keeps these disables from
    // tripping the disable-all guard, so they exercise the directive-type
    // check in parseDisableComment through the real comment parser.
    const NEXT_LINE_MESSAGE = 'Legacy comment must use *-disable-next-line';

    it('rejects a legacy pragma on a block disable', () => {
      const { legacyComments, nonLegacyComments, validationErrors } = callParse(
        {
          sources: {
            'a.ts': `// eslint-disable no-console -- ${DEFAULT_PRAGMA} (no-console) a1b2c3d4\nconsole.log('hi');\n`,
          },
        }
      );
      expect(validationErrors).toEqual([
        {
          message: NEXT_LINE_MESSAGE,
          location: { file: 'a.ts', line: 0 },
        },
      ]);
      expect(legacyComments).toEqual([]);
      expect(nonLegacyComments).toEqual([]);
    });

    it('rejects a legacy pragma on a same-line disable', () => {
      const { legacyComments, nonLegacyComments, validationErrors } = callParse(
        {
          sources: {
            'a.ts': `const x = 1;\nconsole.log(x); // eslint-disable-line no-console -- ${DEFAULT_PRAGMA} (no-console) a1b2c3d4\n`,
          },
        }
      );
      expect(validationErrors).toEqual([
        {
          message: NEXT_LINE_MESSAGE,
          location: { file: 'a.ts', line: 1 },
        },
      ]);
      expect(legacyComments).toEqual([]);
      expect(nonLegacyComments).toEqual([]);
    });
  });

  describe('file parse errors', () => {
    it('surfaces an oxc parse error as a validation error anchored to its line', () => {
      // The broken file fails to parse, so getFileComments records the parser
      // error against the shared validationErrors array parseComments threads
      // through. This is the propagation that makes a syntactically broken file
      // fail validation, and the error is anchored to the offending line.
      const { legacyComments, nonLegacyComments, validationErrors } = callParse(
        {
          sources: { 'a.ts': 'const a = 1;\nconst x = ;\n' },
        }
      );
      expect(validationErrors).toHaveLength(1);
      expect(validationErrors[0].message).toMatch(/^Errors parsing file:/);
      expect(validationErrors[0].location).toEqual({ file: 'a.ts', line: 1 });
      expect(legacyComments).toEqual([]);
      expect(nonLegacyComments).toEqual([]);
    });
  });

  describe('across multiple files', () => {
    it('keeps collecting other files after one file trips the disable-all guard', () => {
      const { legacyComments, nonLegacyComments, validationErrors } = callParse(
        {
          sources: {
            'a.ts': '// eslint-disable\n',
            'b.ts': `${legacyDirective('no-console', 'a1b2c3d4')}\n`,
          },
          nonDisableableRules: ['no-console'],
        }
      );
      // a.ts trips the guard; b.ts is still parsed and its legacy comment kept.
      expect(validationErrors).toEqual([
        {
          message: DISABLE_ALL_MESSAGE,
          location: { file: 'a.ts', line: 0 },
        },
      ]);
      expect(legacyComments).toEqual([
        {
          type: 'legacy',
          file: 'b.ts',
          startLine: 0,
          endLine: 0,
          legaciedRules: ['no-console'],
          nonLegaciedRules: [],
          id: 'a1b2c3d4',
        },
      ]);
      expect(nonLegacyComments).toEqual([]);
    });
  });
});
