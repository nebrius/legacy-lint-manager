export async function readResults() {
  let rawInput = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.resume();
  for await (const chunk of process.stdin) {
    // Chunk will always be a string since we set its encoding above
    rawInput += chunk as string;
  }
  try {
    return JSON.parse(rawInput) as unknown;
  } catch (error) {
    console.error(
      'Could not parse piped results. Did you remember to add --format=json when piping the output?'
    );
    throw error;
  }
}
