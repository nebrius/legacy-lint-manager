import type { Comment } from '../types.js';

// Note: these entries MUST be specified from longest to shortest
// to ensure proper prefix matching. If not, we might only strip out
// "eslint-disable" when we actually need to strip "eslint-disable-next-line".
const DISABLE_PREFIXES = [
  'eslint-disable-next-line',
  'eslint-disable-line',
  'eslint-disable',
  'oxlint-disable-next-line',
  'oxlint-disable-line',
  'oxlint-disable',
];

export function getFileComments({
  filePath,
  fileContents,
}: {
  filePath: string;
  fileContents: string;
}) {
  const lines = fileContents.split('\n');
  const comments: Comment[] = [];
  let currentBlockComment = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('//')) {
      const parsedComment = parseCommentText(line.split('//')[1].trim());
      if (parsedComment) {
        comments.push({
          ...parsedComment,
          file: filePath,
          line: i + 1,
        });
      }
    } else if (line.includes('/*')) {
      currentBlockComment = line.split('/*')[1].trim();
    } else if (line.includes('*/')) {
      currentBlockComment += ' ' + line.split('*/')[0].trim();
      const parsedComment = parseCommentText(currentBlockComment);
      if (parsedComment) {
        comments.push({
          ...parsedComment,
          file: filePath,
          line: i + 1,
        });
      }
      currentBlockComment = '';
    } else if (currentBlockComment) {
      // We normalize multi-line comments into a single line form to make later
      // processing easier
      currentBlockComment += ' ' + line.trim();
    }
  }
  return comments;
}

function parseCommentText(
  text: string
): Omit<Comment, 'file' | 'line'> | undefined {
  // Strip out the disable prefix, if this comment is indeed a disable comment
  let prefixFound = false;
  for (const prefix of DISABLE_PREFIXES) {
    if (text.startsWith(prefix)) {
      text = text.substring(prefix.length).trim();
      prefixFound = true;
      break;
    }
  }

  // If no disable prefix was found, this isn't a valid ESLint/Oxlint comment
  if (!prefixFound) {
    return undefined;
  }

  // Split the comment into rules and optional comment
  const commentParts = text.split('--');
  const rules = commentParts[0].split(',').map((rule) => rule.trim());
  const comment = commentParts[1]?.trim();

  return { rules, comment };
}
