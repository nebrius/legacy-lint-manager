import { getUnprefixedRelativeDir } from './files.js';
import { error } from './logging.js';
import type { ValidationError } from './types.js';

const GLOBAL_ERROR_PREFIX = 'Global';

export function printValidationErrors({
  validationErrors,
  rootDir,
}: {
  validationErrors: ValidationError[];
  rootDir: string;
}): void {
  const groupedErrors = new Map<string, ValidationError[]>();
  for (const validationError of validationErrors) {
    if (validationError.location) {
      if (!groupedErrors.has(validationError.location.file)) {
        groupedErrors.set(validationError.location.file, []);
      }
      groupedErrors.get(validationError.location.file)?.push(validationError);
    } else {
      if (!groupedErrors.has(GLOBAL_ERROR_PREFIX)) {
        groupedErrors.set(GLOBAL_ERROR_PREFIX, []);
      }
      groupedErrors.get(GLOBAL_ERROR_PREFIX)?.push(validationError);
    }
  }
  for (const [file, errors] of groupedErrors) {
    error(
      file === GLOBAL_ERROR_PREFIX
        ? `${GLOBAL_ERROR_PREFIX}:`
        : getUnprefixedRelativeDir({ path: file, rootDir }) + `:`
    );
    for (const err of errors) {
      const line =
        typeof err.location?.line === 'number'
          ? // Internally we store line numbers as 0-indexed, but we want to
            // print them as 1-indexed
            `${(err.location.line + 1).toString()}: `
          : '';
      error(`  ${line}${err.message}`);
    }
  }
}
