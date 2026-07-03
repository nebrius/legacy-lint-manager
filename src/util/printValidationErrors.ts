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
      error(
        `  ${err.location?.line ? `${err.location.line.toString()}: ` : ''}${err.message}`
      );
    }
  }
}
