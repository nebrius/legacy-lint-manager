import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { readConfig } from '../util/config.js';
import { readDatabase } from '../util/db.js';
import { getRepoRoot } from '../util/files.js';
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
  if (!isAbsolute(options.config)) {
    options.config = resolve(process.cwd(), options.config);
  }
  const { ignoreWarnings, databaseFile, pragma, linterType } = readConfig(
    options.config
  );
  const database = readDatabase(databaseFile);
  const results = await time('reading results', () => readResults(inputStream));
  const lintErrors = time('parsing results', () =>
    parseResults({ results, ignoreWarnings, linterType })
  );
  time('adding legacy statements', () => {
    const rootDir = getRepoRoot(options.config);
    for (const filePath of lintErrors.errors.keys()) {
      // Get comments so we can check if we need to add to an existing disable
      const fileContents = readFileSync(filePath, 'utf-8');
      const updatedFileContents = addLegacyStatements({
        pragma,
        lintErrors,
        fileContents,
        filePath,
        rootDir,
      });
      // Save the file if we have results to save. If we don't, that means there
      // was a malformed legacy comment and we should skip this file.
      if (updatedFileContents) {
        writeFileSync(filePath, updatedFileContents);
      }
    }
  });

  time('updating database', () => {
    database.setIds(getIds());
    database.save();
  });
}
