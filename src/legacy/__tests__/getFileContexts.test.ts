import { describe, expect, it } from 'vitest';

import { getFileComments } from '../../util/comments.js';
import { getFileContexts } from '../getFileContexts.js';

function contexts(fileContents: string) {
  const { program, lineStartMapping } = getFileComments({
    filePath: 'test.tsx',
    fileContents,
    validationErrors: [],
  });
  return getFileContexts(program, lineStartMapping);
}

describe('getFileContexts', () => {
  describe('plain JavaScript with no JSX', () => {
    it('returns a single js context for empty input', () => {
      expect(contexts('')).toEqual(['js']);
    });

    it('returns js for every line of whitespace-only input', () => {
      expect(contexts('\n\n\n')).toEqual(['js', 'js', 'js', 'js']);
    });

    it('returns js for a single line of code', () => {
      expect(contexts('const x = 1;')).toEqual(['js']);
    });

    it('returns js for every line of multi-line code', () => {
      expect(
        contexts(`const x = 1;
const y = 2;
const z = 3;`)
      ).toEqual(['js', 'js', 'js']);
    });

    it('produces one context entry per source line', () => {
      const source = `const a = 1;
const b = 2;
const c = 3;`;
      expect(contexts(source)).toHaveLength(source.split('\n').length);
    });
  });

  describe('single-line JSX (mid-line context never affects the line start)', () => {
    it('keeps js when an element opens and closes within one line', () => {
      expect(
        contexts(`const a = <div>hi</div>;
const b = 2;`)
      ).toEqual(['js', 'js']);
    });

    it('keeps js with adjacent expression containers on one line', () => {
      expect(
        contexts(`const a = <div>{x}{y}</div>;
const b = 2;`)
      ).toEqual(['js', 'js']);
    });

    it('returns js for a single-line element followed by a plain js line', () => {
      expect(
        contexts(`const a = <div>{x}</div>;
const b = 2;`)
      ).toEqual(['js', 'js']);
    });
  });

  describe('multi-line elements', () => {
    it('marks child lines as jsx and resumes js after the closing tag', () => {
      expect(
        contexts(`const a = (
  <div>
    {x}
  </div>
);`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'js']);
    });

    it('marks multi-line plain text children as jsx', () => {
      expect(
        contexts(`const a = (
  <div>
    hello
    world
  </div>
);`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'jsx', 'js']);
    });

    it('starts the closing tag line in jsx and the following line in js', () => {
      const result = contexts(`const a = (
  <div>
    hello
  </div>
);`);
      expect(result[3]).toBe('jsx');
      expect(result[4]).toBe('js');
    });

    it('treats the lines of a multi-line opening tag as js, switching to jsx only after the closing >', () => {
      // The attribute region of an opening tag is js context: an eslint-disable
      // next to an attribute must be a `//` comment, not a `{/* */}` one. Only
      // the children (after the `>`) are jsx.
      expect(
        contexts(`const a = (
  <div
    className="x"
  >
    {x}
  </div>
);`)
      ).toEqual(['js', 'js', 'js', 'js', 'jsx', 'jsx', 'js']);
    });

    it('keeps an attribute line js when its element has children on later lines', () => {
      // The attribute lines of a non-self-closing element must stay js: the
      // jsx context begins only after the opening tag's closing `>`, not at
      // the tag's start. Each attribute line, the `>` line, and the
      // closing-tag line must resolve correctly.
      const result = contexts(`const a = (
  <Button
    onClick={fn}
    variant="x"
  >
    Reset
  </Button>
);`);
      expect(result).toEqual([
        'js', // const a = (
        'js', // <Button
        'js', // onClick={fn}
        'js', // variant="x"
        'js', // >
        'jsx', // Reset
        'jsx', // </Button>
        'js', // );
      ]);
    });

    it('keeps the attribute region js even when an attribute expression spans lines', () => {
      // The attribute region is js and the multi-line expression interior is
      // also js, so every line up to the `>` is js; only the child is jsx.
      expect(
        contexts(`const a = (
  <div
    style={
      x
    }
  >
    {y}
  </div>
);`)
      ).toEqual(['js', 'js', 'js', 'js', 'js', 'js', 'jsx', 'jsx', 'js']);
    });
  });

  describe('JSX expression containers', () => {
    it('returns to js for the interior lines of a multi-line expression', () => {
      expect(
        contexts(`const a = (
  <div>
    {
      x
    }
  </div>
);`)
      ).toEqual(['js', 'js', 'jsx', 'js', 'js', 'jsx', 'js']);
    });

    it('treats a comment-only expression container child as jsx around it', () => {
      expect(
        contexts(`const a = (
  <div>
    {/* hi */}
  </div>
);`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'js']);
    });
  });

  describe('fragments', () => {
    it('treats fragment children the same as element children', () => {
      expect(
        contexts(`const a = (
  <>
    {x}
  </>
);`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'js']);
    });
  });

  describe('nested JSX', () => {
    it('keeps nested element children in jsx without spurious transitions', () => {
      expect(
        contexts(`const a = (
  <div>
    <span>
      {x}
    </span>
  </div>
);`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'jsx', 'jsx', 'js']);
    });

    it('returns to js inside an expression that renders nested JSX', () => {
      expect(
        contexts(`const a = (
  <div>
    {cond ? (
      <span>a</span>
    ) : null}
  </div>
);`)
      ).toEqual(['js', 'js', 'jsx', 'js', 'js', 'jsx', 'js']);
    });

    it('handles deeply nested same-context elements', () => {
      expect(
        contexts(`const a = (
  <a>
    <b>
      <c>
        {x}
      </c>
    </b>
  </a>
);`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'jsx', 'jsx', 'jsx', 'jsx', 'js']);
    });

    it('returns to js for a multi-line expression nested inside two elements', () => {
      expect(
        contexts(`const a = (
  <Foo>
    <Bar>
      {
        1
      }
    </Bar>
  </Foo>
);`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'js', 'js', 'jsx', 'jsx', 'js']);
    });
  });

  describe('self-closing elements', () => {
    it('keeps js for a self-closing element on its own line', () => {
      expect(
        contexts(`const a = (
  <Foo />
);`)
      ).toEqual(['js', 'js', 'js']);
    });

    it('keeps a self-closing element inline within an expression as js', () => {
      expect(
        contexts(`const a = <Foo />;
const b = 2;`)
      ).toEqual(['js', 'js']);
    });

    it('keeps all lines of a multi-line self-closing tag as js', () => {
      // A self-closing tag has no children, so every line — the attribute
      // region included — stays js context.
      expect(
        contexts(`const a = (
  <Foo
    bar={1}
  />
);`)
      ).toEqual(['js', 'js', 'js', 'js', 'js']);
    });

    it('marks self-closing sibling lines inside a parent as jsx', () => {
      expect(
        contexts(`const a = (
  <div>
    <A />
    <B />
  </div>
);`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'jsx', 'js']);
    });

    it('does not leak jsx onto a js line after a self-closing element with an attribute expression', () => {
      expect(
        contexts(`const a = <Foo bar={x} />;
const b = 2;`)
      ).toEqual(['js', 'js']);
    });

    it('keeps every line of a multi-line attribute expression as js', () => {
      // Both the attribute region and the expression interior are js context,
      // so the whole self-closing tag stays js.
      expect(
        contexts(`const a = (
  <Foo
    bar={
      1
    }
  />
);`)
      ).toEqual(['js', 'js', 'js', 'js', 'js', 'js', 'js']);
    });
  });

  describe('multiple top-level JSX expressions', () => {
    it('handles a multi-line element followed by a single-line element', () => {
      expect(
        contexts(`const a = (
  <div>
    {x}
  </div>
);
const b = <span>{y}</span>;`)
      ).toEqual(['js', 'js', 'jsx', 'jsx', 'js', 'js']);
    });

    it('handles two separate multi-line elements', () => {
      expect(
        contexts(`const a = (
  <div>
    {x}
  </div>
);
const b = (
  <span>
    {y}
  </span>
);`)
      ).toEqual([
        'js',
        'js',
        'jsx',
        'jsx',
        'js',
        'js',
        'js',
        'jsx',
        'jsx',
        'js',
      ]);
    });
  });
});
