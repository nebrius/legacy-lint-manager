import { afterEach, describe, expect, it, vi } from 'vitest';

import { setVerbose, time } from '../logging.js';

describe('logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset the module-level verbose flag so state doesn't leak between tests.
    setVerbose(false);
  });

  describe('time', () => {
    it('returns the value produced by the callback', () => {
      expect(time('compute', () => 42)).toBe(42);
    });

    it('does not log debug output when verbose mode is disabled', () => {
      const debugSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => undefined);

      setVerbose(false);
      time('Get file list', () => undefined);

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('logs a labeled debug message when verbose mode is enabled', () => {
      const messages: string[] = [];
      vi.spyOn(console, 'debug').mockImplementation((msg: string) => {
        messages.push(msg);
      });

      setVerbose(true);
      time('Get file list', () => undefined);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toBe('[Debug]: Started Get file list');
      expect(messages[1]).toContain('[Debug]: Finished Get file list');
      expect(messages[1]).toContain('ms');
    });

    it('logs the Finished message once an async callback settles', async () => {
      // The promise branch logs from a .then() continuation rather than
      // synchronously, but the message format must match the sync branch.
      const messages: string[] = [];
      vi.spyOn(console, 'debug').mockImplementation((msg: string) => {
        messages.push(msg);
      });

      setVerbose(true);
      const result = await time('Read results', () => Promise.resolve(42));

      expect(result).toBe(42);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBe('[Debug]: Started Read results');
      expect(messages[1]).toContain('[Debug]: Finished Read results');
      expect(messages[1]).toContain('ms');
    });
  });
});
