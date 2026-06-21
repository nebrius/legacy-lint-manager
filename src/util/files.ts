import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

import type { Ignore } from 'ignore';
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
  const ignoreFiles: { path: string; ignores: Ignore[] }[] = [];
  let currentDir = rootDir;
  while (currentDir !== '/') {
    const contents = readdirSync(currentDir);
    if (contents.includes('.gitignore')) {
      ignoreFiles.push({
        path: `${currentDir}/.gitignore`,
        ignores: [
          ignore().add(readFileSync(`${currentDir}/.gitignore`, 'utf-8')),
        ],
      });
    }

    // If we reach the root of the repo, stop looking for more ignore files
    // since git wouldn't include them either
    if (contents.includes('.git')) {
      break;
    }
    currentDir = dirname(currentDir);
  }

  // Get a list of potential files, before filtering through ignore files
  const potentialFilesList = getPotentialFilesList(rootDir);

  // Filter the potential files list using ignore files. We have to take the
  // path of the ignore file into account, since comparisons against the
  // ignore file are relative to the ignore file's location
  const filteredFilesList: string[] = [];
  outer: for (const file of potentialFilesList) {
    for (const ignore of ignoreFiles) {
      const relativePath = relative(dirname(ignore.path), file);
      if (ignore.ignores.some((ig) => ig.ignores(relativePath))) {
        continue outer;
      }
    }

    // If we got here, that means no ignore entry from any ignore file matched
    // this file, so we can add it to our filtered list
    filteredFilesList.push(file);
  }

  // Return all code files, but filter out non-code files
  return filteredFilesList.filter((file) =>
    CODE_EXTENSIONS.includes(extname(file))
  );
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
