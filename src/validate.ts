import type { CommonOptions } from './types.js';
import { getFileList } from './util.js';

export function validate(options: CommonOptions) {
  const files = getFileList(options.rootDir);
  console.log(files);
}
