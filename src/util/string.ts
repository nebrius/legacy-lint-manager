export function commaSeparatedStringToArray(str: string): string[] {
  return (
    str
      .split(',')
      .map((entry) => entry.trim())

      // Ensure we don't end up with `['']` if there are 0 entries
      .filter((entry) => entry.length > 0)
  );
}

// TODO: replace with native RegExp.escape when Node 24 is the minimum
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('-', '\\x2d');
}
