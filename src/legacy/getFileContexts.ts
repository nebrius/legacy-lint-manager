import type { Span } from 'oxc-parser';
import { type Program, Visitor } from 'oxc-parser';

import type { LineContext } from '../types.js';
import { getLineFromIndex } from '../util/comments.js';
import { InternalError } from '../util/error.js';

export function getFileContexts(program: Program, lineStartMapping: number[]) {
  // We always start in a JS context
  const stack: Array<LineContext> = ['js'];

  // We use this to compute all boundary locations. Sometimes multiple contexts
  // may change in a single line, which we ultimately don't care about. By
  // creating a stack of context changes per line, we can flatten it to just
  // the last context to indicate how the next line starts
  const rawFileContexts = new Map<number, Array<LineContext>>();

  function enterContext(node: Span, context: LineContext) {
    stack.push(context);
    const line = getLineFromIndex({
      index: node.start,
      lineStartMapping,
    });
    if (!rawFileContexts.has(line)) {
      rawFileContexts.set(line, []);
    }
    rawFileContexts.get(line)?.push(context);
  }

  function exitContext(node: Span, context: LineContext) {
    const currentContext = stack.pop();
    const nextContext = stack[stack.length - 1];

    // Sanity check
    /* v8 ignore start */
    if (currentContext !== context) {
      throw new InternalError(`Corrupted context stack detected`);
    }
    /* v8 ignore stop */

    // If this isn't a context change, don't mark the transition
    if (nextContext === currentContext) {
      return;
    }

    const line = getLineFromIndex({
      index: node.end,
      lineStartMapping,
    });
    if (!rawFileContexts.has(line)) {
      rawFileContexts.set(line, []);
    }
    rawFileContexts.get(line)?.push(nextContext);
  }

  const visitor = new Visitor({
    JSXOpeningElement(node) {
      enterContext(node, 'jsx');
    },
    'JSXOpeningElement:exit'(node) {
      // Self-closing elements may split across multiple lines where we may
      // need to add a disable comment, and attributes inside the node may have
      // js interpolated expressions that need to be processed before this part
      if (node.selfClosing) {
        exitContext(node, 'jsx');
        return;
      }
    },
    JSXClosingElement(node) {
      exitContext(node, 'jsx');
    },

    JSXOpeningFragment(node) {
      enterContext(node, 'jsx');
    },
    JSXClosingFragment(node) {
      exitContext(node, 'jsx');
    },

    JSXExpressionContainer(node) {
      enterContext(node, 'js');
    },
    'JSXExpressionContainer:exit'(node) {
      exitContext(node, 'js');
    },
  });
  visitor.visit(program);

  // Flatten and deduplicate the rawFileContents
  const flattenedRawFileContexts: Array<{
    line: number;
    context: LineContext;
  }> = [];
  for (const [line, contexts] of rawFileContexts) {
    const lastContext = contexts.at(-1);

    /* v8 ignore start */
    if (!lastContext) {
      throw new InternalError(
        `Raw file context is unexpectedly empty at line ${line.toString()}`
      );
    }
    /* v8 ignore stop */

    if (flattenedRawFileContexts.at(-1)?.context !== lastContext) {
      flattenedRawFileContexts.push({ line, context: lastContext });
    }
  }

  // Build the final fileContexts array
  const fileContexts: LineContext[] = ['js'];
  let currentContext: LineContext = 'js';
  let nextContextEntry = flattenedRawFileContexts.shift();
  for (let i = 0; i < lineStartMapping.length - 1; i++) {
    if (i === nextContextEntry?.line) {
      currentContext = nextContextEntry.context;
      nextContextEntry = flattenedRawFileContexts.shift();
    }
    fileContexts.push(currentContext);
  }

  return fileContexts;
}
