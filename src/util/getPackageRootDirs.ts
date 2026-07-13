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
    if (!packageRootDirs.includes(ignoredPackagePath)) {
      validationErrors.push({
        message: `Unknown ignore package path "${ignoredPackagePath}"`,
      });
    }
  }
  return packageRootDirs.filter((dir) => !ignorePackagePaths.includes(dir));
}
