import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../config.js';
import { createConfig, readConfig } from '../config.js';

const CONFIG_FILE = join(tmpdir(), 'legacy-lint-config-test.jsonc');
const MISSING_CONFIG = join(tmpdir(), 'legacy-lint-config-missing.jsonc');

const VALID_CONFIG: Config = {
  ignoreWarnings: false,
  pragma: 'This lint error is legacied. DO NOT COPY',
  databaseFile: 'legacy-lint.data.json',
  nonDisableableRules: ['no-console'],
  compareBranch: 'main',
  linterType: 'eslint',
};

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
}

describe('config', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(CONFIG_FILE, { force: true });
  });

  describe('createConfig', () => {
    it('writes a config file that readConfig reads back unchanged', () => {
      createConfig({ data: VALID_CONFIG, filePath: CONFIG_FILE });
      expect(readConfig(CONFIG_FILE)).toEqual(VALID_CONFIG);
    });
  });

  describe('readConfig', () => {
    it('parses JSON-C with comments and a trailing comma', () => {
      writeFileSync(
        CONFIG_FILE,
        [
          '{',
          '  // whether warnings are ignored',
          '  "ignoreWarnings": false,',
          '  "pragma": "P",',
          '  "databaseFile": "db.json",',
          '  "nonDisableableRules": [],',
          '  "compareBranch": "main",',
          '  "linterType": "eslint",',
          '}',
        ].join('\n')
      );

      expect(readConfig(CONFIG_FILE)).toEqual({
        ignoreWarnings: false,
        pragma: 'P',
        databaseFile: 'db.json',
        nonDisableableRules: [],
        compareBranch: 'main',
        linterType: 'eslint',
      });
    });

    it('reads back oxlint as a valid linterType', () => {
      createConfig({
        data: { ...VALID_CONFIG, linterType: 'oxlint' },
        filePath: CONFIG_FILE,
      });
      expect(readConfig(CONFIG_FILE)).toEqual({
        ...VALID_CONFIG,
        linterType: 'oxlint',
      });
    });

    it('throws when linterType is not a supported linter', () => {
      writeFileSync(
        CONFIG_FILE,
        JSON.stringify({ ...VALID_CONFIG, linterType: 'tslint' })
      );
      expect(() => readConfig(CONFIG_FILE)).toThrow('Invalid config file');
    });

    it('exits when the config file does not exist', () => {
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => readConfig(MISSING_CONFIG)).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Config file not found')
      );
    });

    it('exits when the config file is malformed JSON-C', () => {
      writeFileSync(CONFIG_FILE, '{ "ignoreWarnings": }');
      const exitSpy = mockExit();
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      expect(() => readConfig(CONFIG_FILE)).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse config file')
      );
    });

    it('throws when the config does not match the schema', () => {
      writeFileSync(CONFIG_FILE, JSON.stringify({ ignoreWarnings: 'yes' }));
      expect(() => readConfig(CONFIG_FILE)).toThrow('Invalid config file');
    });
  });
});
