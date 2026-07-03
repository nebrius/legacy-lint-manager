export type CommonOptions = {
  config: string;
  verbose: boolean;
};

type CommentBase = {
  file: string;
  startLine: number;
  endLine: number;
  rules: string[];
};

export type Comment = CommentBase & {
  type: 'next-line' | 'same-line' | 'block';
  disabledAll: boolean;
  comment?: string;
};

export type LegacyComment = Omit<CommentBase, 'rules'> & {
  type: 'legacy';
  legaciedRules: string[];
  nonLegaciedRules: string[];
  id: string;
};

export type NonLegacyComment = CommentBase & {
  type: 'nonlegacy';
};

export type ValidationError = {
  message: string;
  location?: {
    file: string;
    line: number;
  };
};

// Mapping from file path to line number to rules
export type LintErrors = {
  type: 'oxlint' | 'eslint';
  errors: Map<string, Map<number, string[]>>;
};

export type LineContext = 'js' | 'jsx';
