export function commaSeparatedStringToArray(str: string): string[] {
  return (
    str
      .split(',')
      .map((entry) => entry.trim())

      // Ensure we don't end up with `['']` if there are 0 entries
      .filter((entry) => entry.length > 0)
  );
}
