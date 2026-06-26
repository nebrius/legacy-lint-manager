import { readFileSync, writeFileSync } from 'node:fs';
import type { Readable } from 'node:stream';

import type { CommonOptions } from '../types.js';
import { fromFile } from '../util/db.js';
import { setVerbose, time } from '../util/logging.js';
import { addLegacyStatements } from './addLegacyStatements.js';
import { getIds } from './generateIds.js';
import { parseResults } from './parseResults.js';
import { readResults } from './readResults.js';

export async function legacyExistingErrors(
  options: CommonOptions,
  inputStream: Readable = process.stdin
) {
  setVerbose(options.verbose);
  const results = await time('reading results', () => readResults(inputStream));
  const lintErrors = time('parsing results', () => parseResults(results));
  time('adding legacy statements', () => {
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

  time('updating database', () => {
    const database = fromFile(options.databaseFile);
    database.setIds(getIds());
    database.save();
  });
}
