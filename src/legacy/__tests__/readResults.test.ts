import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readResults } from '../readResults.js';

// Builds an in-memory readable stream from the given chunks. readResults only
// uses the Readable surface (setEncoding, resume, async-iteration), so a
// Readable.from(...) is a complete stand-in for process.stdin.
function streamOf(...chunks: Array<string | Buffer>) {
  return Readable.from(chunks);
}

const PARSE_ERROR_MESSAGE =
  'Could not parse piped results. Did you remember to add --format=json when piping the output?';

describe('readResults', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('valid JSON', () => {
    it('parses a single-chunk JSON payload', async () => {
      const payload = [{ filePath: 'a.ts', messages: [] }];
      await expect(
        readResults(streamOf(JSON.stringify(payload)))
      ).resolves.toEqual(payload);
    });

    it('reassembles input split across multiple chunks', async () => {
      await expect(readResults(streamOf('{"a":', '1}'))).resolves.toEqual({
        a: 1,
      });
    });

    it('parses an empty array payload', async () => {
      await expect(readResults(streamOf('[]'))).resolves.toEqual([]);
    });

    it('parses an empty object payload', async () => {
      await expect(readResults(streamOf('{}'))).resolves.toEqual({});
    });

    it('decodes Buffer chunks as utf-8 strings', async () => {
      await expect(
        readResults(streamOf(Buffer.from('{"a":1}')))
      ).resolves.toEqual({ a: 1 });
    });
  });

  describe('invalid JSON', () => {
    it('rejects and logs guidance for malformed input', async () => {
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      await expect(readResults(streamOf('not json'))).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(PARSE_ERROR_MESSAGE);
    });

    it('rejects and logs guidance for empty input', async () => {
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      await expect(readResults(streamOf(''))).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(PARSE_ERROR_MESSAGE);
    });
  });
});
