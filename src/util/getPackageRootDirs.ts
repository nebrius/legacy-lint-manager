import { getPackagesSync } from '@manypkg/get-packages';

export function getPackageRootDirs(repoRootDir: string) {
  const { packages } = getPackagesSync(repoRootDir);
  return packages.map((pkg) => pkg.dir);
}
