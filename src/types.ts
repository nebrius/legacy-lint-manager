export const DEFAULT_PRAGMA =
  'This lint error is legacied. DO NOT COPY THIS PATTERN';

export type CommonOptions = {
  pragma: string;
  databaseFile: string;
  rootDir: string;
};

export type Comment = {
  rules: string[];
  comment?: string;
  file: string;
  line: number;
};
