import { execSync } from 'node:child_process';

import { fromContents } from '../util/db.js';
import { error } from '../util/logging.js';

export function compareDatabases({
  compareBranch,
  usedIds,
  databaseFile,
}: {
  compareBranch: string | undefined;
  usedIds: string[];
  databaseFile: string;
}) {
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

  const previousIds = compareDatabase.getIds();
  const newIds = usedIds.filter((id) => !previousIds.includes(id));
  if (newIds.length > 0) {
    error(
      `Unknown legacy statements found in codebase. New legacied lint failures are not allowed. Unknown IDs:\n  ${newIds.join('\n  ')}`
    );
    process.exit(1);
  }
}
