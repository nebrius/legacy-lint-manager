import type { CommonOptions } from '../types.js';
import { setVerbose, time } from '../util/logging.js';
import { addLegacyStatements } from './addLegacyStatements.js';
import { parseResults } from './parseResults.js';
import { streamResults } from './streamResults.js';

export async function legacyExistingErrors(options: CommonOptions) {
  setVerbose(options.verbose);
  const results = await time('Reading results', streamResults);
  const linterrors = time('Parse results', () => parseResults(results));
  time('Adding legacy statements', () => {
    addLegacyStatements({
      pragma: options.pragma,
      lintErrors: linterrors,
    });
  });
}
