import { sep } from 'node:path';

import { error } from './logging.js';
import type { ValidationError } from './types.js';

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
      if (!groupedErrors.has('Global')) {
        groupedErrors.set('Global', []);
      }
      groupedErrors.get('Global')?.push(validationError);
    }
  }
  for (const [file, errors] of groupedErrors) {
    error(`${file.replace(rootDir + sep, '')}:`);
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
