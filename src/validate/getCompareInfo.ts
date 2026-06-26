import { execSync } from 'node:child_process';

import { fromContents } from '../util/db.js';

export type CompareInfo = {
  expectedIds: Set<string>;
  compareBranchName: string;
};

export function getCompareInfo({
  compareBranch,
  databaseFile,
}: {
  compareBranch: string | undefined;
  databaseFile: string;
}): CompareInfo {
  // Get the default branch if an explicit branch was not provided
  if (!compareBranch) {
    compareBranch = execSync(
      'git symbolic-ref refs/remotes/origin/HEAD --short',
      {
        encoding: 'utf-8',
      }
    )
      .replace('origin/', '')
      .trim();
  }

  // Read in the database from the compare branch
  const compareDatabaseContent = execSync(
    `git show ${compareBranch}:${databaseFile}`,
    {
      encoding: 'utf-8',
    }
  );
  const compareDatabase = fromContents(
    JSON.parse(compareDatabaseContent) as unknown
  );

  return {
    expectedIds: new Set(compareDatabase.getIds()),
    compareBranchName: compareBranch,
  };
}
