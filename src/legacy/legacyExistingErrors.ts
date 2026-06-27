import { readFileSync, writeFileSync } from 'node:fs';
import type { Readable } from 'node:stream';

import { readConfig } from '../util/config.js';
import { readDatabase } from '../util/db.js';
import { setVerbose, time } from '../util/logging.js';
import type { CommonOptions } from '../util/types.js';
import { addLegacyStatements } from './addLegacyStatements.js';
import { getIds } from './generateIds.js';
import { parseResults } from './parseResults.js';
import { readResults } from './readResults.js';

export async function legacyExistingErrors(
  options: CommonOptions,
  inputStream: Readable
) {
  setVerbose(options.verbose);
  const { ignoreWarnings, databaseFile, pragma } = readConfig(options.config);
  const database = readDatabase(databaseFile);
  const results = await time('reading results', () => readResults(inputStream));
  const lintErrors = time('parsing results', () =>
    parseResults({ results, ignoreWarnings })
  );
  time('adding legacy statements', () => {
    for (const filePath of lintErrors.errors.keys()) {
      // Get comments so we can check if we need to add to an existing disable
      const fileContents = readFileSync(filePath, 'utf-8');
      const updatedFileContents = addLegacyStatements({
        pragma,
        lintErrors,
        fileContents,
        filePath,
      });
      // Save the file
      writeFileSync(filePath, updatedFileContents);
    }
  });

  time('updating database', () => {
    database.setIds(getIds());
    database.save();
  });
}
