import type { CommonOptions } from '../types.js';
import { setVerbose } from '../util/logging.js';
import { parseResults } from './parseResults.js';
import { streamResults } from './streamResults.js';

export async function legacyExistingErrors(options: CommonOptions) {
  setVerbose(options.verbose);
  const results = await streamResults();
  const linterrors = parseResults(results);
  console.log(linterrors);
}
