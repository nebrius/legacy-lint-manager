import { readFileSync } from 'node:fs';

import type { CommonOptions } from './types.js';
import { getFileComments } from './util/comments.js';
import { getFileList } from './util/files.js';

export function validate(options: CommonOptions) {
  const files = getFileList(options.rootDir);

  for (const file of files) {
    const comments = getFileComments({
      filePath: file,
      fileContents: readFileSync(file, 'utf-8'),
    });
    console.log(file, comments);
  }

  console.log('Done!');
}
