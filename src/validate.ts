import { readFileSync } from 'node:fs';

import type { CommonOptions } from './types.js';
import { getFileComments } from './util/comments.js';
import { getFileList } from './util/files.js';
import { setVerbose } from './util/logging.js';
import { time } from './util/time.js';

export function validate(options: CommonOptions) {
  setVerbose(options.verbose);
  const files = time('getFileList', () => getFileList(options.rootDir));

  time('getFileComments', () => {
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
