export const DEFAULT_PRAGMA = 'This lint error is legacied. DO NOT COPY';

export type CommonOptions = {
  pragma: string;
  databaseFile: string;
  rootDir: string;
  verbose: boolean;
};

export type Comment = {
  rules: string[];
  disabledAll: boolean;
  comment?: string;
  file: string;
  line: number;
};

export type LegacyComment = {
  file: string;
  line: number;
  rules: string[];
  id: string;
};

export type ValidationError = {
  message: string;
  file: string;
  line: number;
};

// Mapping from file path to line number to rules
export type LintErrors = Map<string, Map<number, string[]>>;
