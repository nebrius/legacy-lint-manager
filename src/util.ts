import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

import ignore from 'ignore';

// Remember to update the README when changing this list
const DEFAULT_IGNORE_DIRECTORIES = ['node_modules', 'dist', 'build', 'out'];
const CODE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.cts',
  '.mts',
  '.js',
  '.jsx',
  '.cjs',
  '.mjs',
];

export function getFileList(rootDir: string) {
  // Collect gitignore files that apply to this root dir
  const ignoreFilePaths: string[] = [];
  let currentDir = rootDir;
  while (currentDir !== '/') {
    const contents = readdirSync(currentDir);
    if (contents.includes('.gitignore')) {
      ignoreFilePaths.push(`${currentDir}/.gitignore`);
    }
    if (contents.includes('.git')) {
      break;
    }
    currentDir = dirname(currentDir);
  }
  const ignoreFileContents = ignoreFilePaths.flatMap((path) =>
    readFileSync(path, 'utf-8').split('\n')
  );

  // Get a list of potential files, before filtering through ignore files
  const potentialFilesList = getPotentialFilesList(rootDir);

  // Filter the potential files list using ignore files
  const ig = ignore().add(ignoreFileContents);
  const files = ig.filter(
    potentialFilesList.map((file) => relative(rootDir, file))
  );

  // Return all code files, but filter out non-code files
  return files.filter((file) => CODE_EXTENSIONS.includes(extname(file)));
}

// Get a potential list of files, automatically filtering out a few directories
// known to contain lots of files we always want to ignore early on for perf
// reasons. Waiting to check against ignores incurs a big perf hit due to the
// more complex and Regex based logic of ignores.
function getPotentialFilesList(dir: string): string[] {
  const potentialFilesList: string[] = [];

  const dirContents = readdirSync(dir, {
    withFileTypes: true,
  });

  for (const content of dirContents) {
    if (!content.isDirectory()) {
      potentialFilesList.push(join(dir, content.name));
    } else if (!DEFAULT_IGNORE_DIRECTORIES.includes(content.name)) {
      potentialFilesList.push(
        ...getPotentialFilesList(join(dir, content.name))
      );
    }
  }

  return potentialFilesList;
}
