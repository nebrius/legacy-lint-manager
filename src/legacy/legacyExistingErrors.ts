import { readFileSync, writeFileSync } from 'node:fs';

import type { CommonOptions } from '../types.js';
import { setVerbose, time } from '../util/logging.js';
import { addLegacyStatements } from './addLegacyStatements.js';
import { parseResults } from './parseResults.js';
import { readResults } from './readResults.js';

export async function legacyExistingErrors(options: CommonOptions) {
  setVerbose(options.verbose);
  const results = await time('Reading results', readResults);
  const lintErrors = time('Parsing results', () => parseResults(results));
  time('Adding legacy statements', () => {
    for (const filePath of lintErrors.errors.keys()) {
      // Get comments so we can check if we need to add to an existing disable
      const fileContents = readFileSync(filePath, 'utf-8');
      const updatedFileContents = addLegacyStatements({
        pragma: options.pragma,
        lintErrors,
        fileContents,
        filePath,
      });
      // Save the file
      writeFileSync(filePath, updatedFileContents);
    }
  });
}
