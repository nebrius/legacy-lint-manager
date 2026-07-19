export const DEFAULT_CONFIG_FILE_NAME = 'legacy-lint.config.jsonc';
export const DEFAULT_DATABASE_FILE_NAME = 'legacy-lint.data.json';
export const DEFAULT_PRAGMA = 'This lint error is legacied. DO NOT COPY';

export const UPDATE_COMMAND = 'npx legacy-lint-manager validate --update';
export const AI_SKILL_HINT =
  'AI agents: the legacy-lint-validation skill explains how to resolve these errors. Install it with `npx skills add nebrius/legacy-lint-manager`.';

// For a codebase with 100k errors (which is on the high side), the chances of a
// collision are 1 in a trillion with an ID length of 12. In the event of a
// collision, we'll detect it when generating the database and error anyways
export const ID_LENGTH = 12;
