import { getPackagesSync } from '@manypkg/get-packages';

import type { Config } from './config.js';
import type { ValidationError } from './types.js';

export function getPackageRootDirs({
  repoRootDir,
  monorepoConfig: { ignorePackagePaths },
  validationErrors,
}: {
  repoRootDir: string;
  monorepoConfig: NonNullable<Config['monorepoConfig']>;
  validationErrors: ValidationError[];
}) {
  const { packages } = getPackagesSync(repoRootDir);
  const packageRootDirs = packages.map((pkg) => pkg.dir);
  for (const ignoredPackagePath of ignorePackagePaths) {
    // If this is a wildcard, it's required to come at the end, which simplifies
    // our logic
    if (ignoredPackagePath.endsWith('/*')) {
      if (
        !packageRootDirs.some((dir) =>
          dir.startsWith(ignoredPackagePath.slice(0, -1))
        )
      ) {
        validationErrors.push({
          message: `Ignore package path wildcard "${ignoredPackagePath}" did not match any packages`,
        });
      }
    } else if (!packageRootDirs.includes(ignoredPackagePath)) {
      validationErrors.push({
        message: `Unknown ignore package path "${ignoredPackagePath}"`,
      });
    }
  }
  return packageRootDirs.filter(
    (dir) => !matchesIgnorePackagePaths(dir, ignorePackagePaths)
  );
}

export function matchesIgnorePackagePaths(
  dir: string,
  ignorePackagePaths: string[]
) {
  return ignorePackagePaths.some((ignorePath) =>
    ignorePath.endsWith('/*')
      ? dir.startsWith(ignorePath.slice(0, -1))
      : dir === ignorePath
  );
}
