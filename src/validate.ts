import { readFileSync } from 'node:fs';

import type { CommonOptions } from './types.js';
import { getFileComments } from './util/comments.js';
import { getFileList } from './util/files.js';
import { setVerbose, time } from './util/logging.js';

export function validate(options: CommonOptions) {
  setVerbose(options.verbose);
  const files = time('Get file list', () => getFileList(options.rootDir));

  time('Get file comments', () => {
    for (const file of files) {
      const comments = getFileComments({
        filePath: file,
        fileContents: readFileSync(file, 'utf-8'),
      });
      console.log(file, comments);
    }
  });

  console.log('Done!');
}
