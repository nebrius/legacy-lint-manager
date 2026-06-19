import type { CommonOptions } from './types.js';
import { setVerbose } from './util/logging.js';

export function legacyExistingErrors(options: CommonOptions) {
  setVerbose(options.verbose);
  console.log('legacyExistingErrors');
  console.log(options);
}
