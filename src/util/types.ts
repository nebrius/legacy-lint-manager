export type CommonOptions = {
  config: string;
  verbose: boolean;
};

export type Comment = {
  type: 'next-line' | 'same-line' | 'block';
  rules: string[];
  disabledAll: boolean;
  comment?: string;
  file: string;
  startLine: number;
  endLine: number;
};

export type LegacyComment = {
  file: string;
  startLine: number;
  endLine: number;
  rules: string[];
  id: string;
};

export type ValidationError = {
  message: string;
  file: string;
  line: number;
};

// Mapping from file path to line number to rules
export type LintErrors = {
  type: 'oxlint' | 'eslint';
  errors: Map<string, Map<number, string[]>>;
};

export type LineContext = 'js' | 'jsx';
