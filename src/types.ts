export const DEFAULT_PRAGMA =
  'This lint error is legacied. DO NOT COPY THIS PATTERN';

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
