import type { Readable } from 'node:stream';

// Reads the results from stdin, which is supposed to be the output of running
// eslint/oxlint with the --format=json flag. This function sits early in the
// pipeline and only ensures that the input could be parsed as JSON. Later steps
// will validate the structure of the JSON.
export async function readResults(readableStream: Readable) {
  let rawInput = '';
  readableStream.setEncoding('utf-8');
  readableStream.resume();
  for await (const chunk of readableStream) {
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
