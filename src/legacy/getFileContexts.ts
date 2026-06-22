import type { Span } from 'oxc-parser';
import { type Program, Visitor } from 'oxc-parser';

import type { LineContext } from '../types.js';
import { InternalError } from '../util/error.js';

export function getFileContexts(program: Program, fileContents: string) {
  // We always start in a JS context
  const stack: Array<LineContext> = ['js'];

  // We use this to compute all boundary locations. Sometimes multiple contexts
  // may change in a single line, which we ultimately don't care about. By
  // creating a stack of context changes per line, we can flatten it to just
  // the last context to indicate how the next line starts
  const rawFileContexts = new Map<number, Array<LineContext>>();
  rawFileContexts.set(0, ['js']);

  // Compute a mapping of line number (0-indexed) to file offsets
  const lineStartMapping = [0]; // line 0 always maps to position 0
  for (let i = 0; i < fileContents.length; i++) {
    if (fileContents[i] === '\n') {
      lineStartMapping.push(i);
    }
  }

  function getLineNumber(index: number) {
    let line = 0;
    while (lineStartMapping[line] < index) {
      line++;
    }
    return line;
  }

  function enterContext(node: Span, context: LineContext) {
    stack.push(context);
    if (stack.length && stack[stack.length] === context) {
      return;
    }
    const line = getLineNumber(node.start);
    if (!rawFileContexts.has(line)) {
      rawFileContexts.set(line, []);
    }
    rawFileContexts.get(line)?.push(context);
  }

  function exitContext(node: Span, context: LineContext) {
    const currentContext = stack.pop();
    const nextContext = stack[stack.length - 1];

    // Sanity check
    if (currentContext !== context) {
      throw new InternalError(`Corrupted context stack detected`);
    }

    // If this isn't a context change, don't mark the transition
    if (nextContext === currentContext) {
      return;
    }

    const line = getLineNumber(node.end);
    if (!rawFileContexts.has(line)) {
      rawFileContexts.set(line, []);
    }
    rawFileContexts.get(line)?.push(nextContext);
  }

  const visitor = new Visitor({
    JSXOpeningElement(node) {
      enterContext(node, 'jsx');
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

  const fileContexts: LineContext[] = [];
  let currentContextLine = 0;
  let currentContext: LineContext = 'js';
  for (const [line, contexts] of rawFileContexts) {
    const nextContext = contexts.pop();
    if (!nextContext) {
      throw new InternalError(`Raw file context is unexpectedly undefined`);
    }
    for (; currentContextLine < line; currentContextLine++) {
      fileContexts[currentContextLine] = currentContext;
    }
    currentContext = nextContext;
  }
  for (let i = currentContextLine; i < lineStartMapping.length; i++) {
    fileContexts[i] = currentContext;
  }

  return fileContexts;
}
