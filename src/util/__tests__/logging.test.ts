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

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('[Debug]: Get file list:');
      expect(messages[0]).toContain('ms');
    });
  });
});
