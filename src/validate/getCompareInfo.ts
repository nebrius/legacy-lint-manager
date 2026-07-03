import { execSync } from 'node:child_process';

import type { Database } from '../util/db.js';
import { createDatabase } from '../util/db.js';

export type CompareInfo = {
  compareDatabase: Database;
  compareBranchName: string;
};

export function getCompareInfo({
  compareBranch,
  databaseFile,
}: {
  compareBranch: string;
  databaseFile: string;
}): CompareInfo {
  // Read in the database from the compare branch
  const compareDatabaseContent = execSync(
    `git show ${compareBranch}:${databaseFile}`,
    {
      encoding: 'utf-8',
    }
  );
  const compareDatabase = createDatabase({
    filePath: undefined,
    databaseContents: JSON.parse(compareDatabaseContent) as unknown,
  });

  return {
    compareDatabase,
    compareBranchName: compareBranch,
  };
}
