export async function streamResults() {
  let rawInput = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.resume();
  for await (const chunk of process.stdin) {
    // Chunk will always be a string since we set its encoding above
    rawInput += chunk as string;
  }
  return JSON.parse(rawInput) as unknown;
}
