export type CommonOptions = {
  config: string;
  verbose: boolean;
};

type CommentBase = {
  file: string;
  // Start index in the file, not include the opening comment token (e.g. `//` or `/*`)
  startIndex: number;
  startLine: number;
  // End index in the file, not include the closing block token if it exists (e.g. `*/`)
  endIndex: number;
  endLine: number;
  // The index of the `--` delimiter, or undefined if there isn't one
  descriptionStartIndex: number | undefined;
  rules: string[];
};

export type Comment = CommentBase & {
  type: 'next-line' | 'same-line' | 'block';
  disabledAll: boolean;
  comment?: string;
};

export type LegacyComment = Omit<CommentBase, 'rules'> & {
  type: 'legacy';
  // Rules in the legacy list that are listed in the actual disable list
  legaciedRules: string[];
  // Rules in the actual disable list that are not in the legacy list, aka
  // disables the user added alongside the legacy
  nonLegaciedRules: string[];
  // Rules in the legacy list that are not in the actual disable list anymore,
  // aka rules whose violations were fixed
  unusedLegaciedRules: string[];
  id: string;
  // This index always exists for legacy comments
  descriptionStartIndex: number;
  // Index of the opening `(` in the legacy comment
  legaciedRulesStartIndex: number;
  // Index just past the closing `)` in the legacy comment
  legaciedRulesEndIndex: number;
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
