import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path';

import type { Ignore } from 'ignore';
import ignore from 'ignore';

import { InternalError } from './error.js';

const DEFAULT_IGNORE_DIRECTORIES = ['node_modules'];
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

// Get the root of the git repository that contains the given file or directory,
// which is typically either process.cwd() or a config file path
export function getRepoRoot(fileOrDirectory: string) {
  let currentDir = statSync(fileOrDirectory).isDirectory()
    ? fileOrDirectory
    : dirname(fileOrDirectory);
  while (currentDir !== '/') {
    const contents = readdirSync(currentDir);
    if (contents.includes('.git')) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }
  throw new Error(
    `Could not determine repo root from file or directory ${fileOrDirectory}. This command must be run from inside a git repository.`
  );
}

// This computes a relative path from the root directory
export function getUnprefixedRelativeDir({
  path,
  rootDir,
}: {
  path: string;
  rootDir: string;
}) {
  if (!isAbsolute(path)) {
    throw new InternalError(
      `Expected ${path} to be an absolute path but it was not`
    );
  }
  if (!path.startsWith(rootDir + sep)) {
    throw new InternalError(`Expected ${path} to start with ${rootDir + sep}`);
  }
  return path.slice(rootDir.length + 1);
}

export function getFileList(rootDir: string) {
  // Collect gitignore files that apply to this root dir
  const baseIgnoreFiles: { path: string; ignores: Ignore[] }[] = [];
  let currentDir = rootDir;
  while (currentDir !== '/') {
    const contents = readdirSync(currentDir);
    if (contents.includes('.gitignore')) {
      baseIgnoreFiles.push(loadGitIgnoreFile(`${currentDir}/.gitignore`));
    }

    // If we reach the root of the repo, stop looking for more ignore files
    // since git wouldn't include them either
    if (contents.includes('.git')) {
      break;
    }
    currentDir = dirname(currentDir);
  }

  return getFilesList(rootDir, baseIgnoreFiles);
}

// Get a potential list of files, automatically filtering out a few directories
// known to contain lots of files we always want to ignore early on for perf
// reasons. Waiting to check against ignores incurs a big perf hit due to the
// more complex and Regex based logic of ignores.
function getFilesList(
  dir: string,
  ignoreFiles: { path: string; ignores: Ignore[] }[]
): string[] {
  const potentialFilesList: string[] = [];

  const dirContents = readdirSync(dir, {
    withFileTypes: true,
  });

  const ignoreFile = dirContents.find(
    (content) => content.name === '.gitignore'
  );
  if (ignoreFile) {
    // Make a shallow copy so we scope this change just to this recursion level
    ignoreFiles = [...ignoreFiles, loadGitIgnoreFile(`${dir}/.gitignore`)];
  }

  outer: for (const content of dirContents) {
    const filePath = join(dir, content.name);
    for (const ignore of ignoreFiles) {
      const relativePath = relative(dirname(ignore.path), filePath);
      if (ignore.ignores.some((ig) => ig.ignores(relativePath))) {
        continue outer;
      }
    }
    if (!content.isDirectory()) {
      if (CODE_EXTENSIONS.includes(extname(content.name))) {
        potentialFilesList.push(filePath);
      }
    } else if (!DEFAULT_IGNORE_DIRECTORIES.includes(content.name)) {
      potentialFilesList.push(...getFilesList(filePath, ignoreFiles));
    }
  }

  return potentialFilesList;
}

function loadGitIgnoreFile(path: string) {
  return {
    path,
    ignores: [ignore().add(readFileSync(path, 'utf-8'))],
  };
}
