import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../config.js';
import {
  createConfig,
  getPackageSpecificConfig,
  parsePackageConfigOverride,
  readConfig,
} from '../config.js';
import { DEFAULT_CONFIG_FILE_NAME } from '../constants.js';

const CONFIG_FILE = join(tmpdir(), 'legacy-lint-config-test.jsonc');
const MISSING_CONFIG = join(tmpdir(), 'legacy-lint-config-missing.jsonc');
// A throwaway package root; override files always live at the package root
// under the default config file name.
const PKG_DIR = join(tmpdir(), 'legacy-lint-config-test-pkg');
const PKG_OVERRIDE_FILE = join(PKG_DIR, DEFAULT_CONFIG_FILE_NAME);

const VALID_CONFIG: Config = {
  lintCommand: { command: 'npx', args: ['eslint', '--format=json'] },
  ignoreWarnings: false,
  pragma: 'This lint error is legacied. DO NOT COPY',
  databaseFile: 'legacy-lint.data.json',
  nonDisableableRules: ['no-console'],
  compareBranch: 'main',
  linterType: 'eslint',
};

// readConfig resolves a relative databaseFile to an absolute path against the
// config file's own directory, so what is read back differs from what was
// written only in that field.
const VALID_CONFIG_READBACK: Config = {
  ...VALID_CONFIG,
  databaseFile: resolve(dirname(CONFIG_FILE), VALID_CONFIG.databaseFile),
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
    rmSync(PKG_DIR, { recursive: true, force: true });
  });

  describe('createConfig', () => {
    it('writes a config file that readConfig reads back, resolving databaseFile to an absolute path', () => {
      createConfig({ data: VALID_CONFIG, filePath: CONFIG_FILE });
      expect(readConfig(CONFIG_FILE)).toEqual(VALID_CONFIG_READBACK);
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
          '  "lintCommand": { "command": "npx", "args": ["eslint"] },',
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
        lintCommand: { command: 'npx', args: ['eslint'] },
        pragma: 'P',
        // The relative databaseFile is resolved against the config's directory.
        databaseFile: resolve(dirname(CONFIG_FILE), 'db.json'),
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
        ...VALID_CONFIG_READBACK,
        linterType: 'oxlint',
      });
    });

    it('leaves an already-absolute databaseFile unchanged', () => {
      const absoluteDb = join(tmpdir(), 'elsewhere', 'legacy-lint.data.json');
      createConfig({
        data: { ...VALID_CONFIG, databaseFile: absoluteDb },
        filePath: CONFIG_FILE,
      });
      expect(readConfig(CONFIG_FILE).databaseFile).toBe(absoluteDb);
    });

    it('resolves a relative databaseFile against the config directory, not the cwd', () => {
      createConfig({
        data: { ...VALID_CONFIG, databaseFile: 'nested/db.json' },
        filePath: CONFIG_FILE,
      });
      const databaseFile = readConfig(CONFIG_FILE).databaseFile;
      // The path is anchored at the config file's directory...
      expect(databaseFile).toBe(
        resolve(dirname(CONFIG_FILE), 'nested/db.json')
      );
      // ...and explicitly not at process.cwd() (the config lives in tmpdir,
      // which differs from the cwd), so the tool finds the database regardless
      // of where it was invoked from.
      expect(databaseFile).not.toBe(resolve(process.cwd(), 'nested/db.json'));
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

    it('throws when lintCommand is missing', () => {
      const config: Record<string, unknown> = { ...VALID_CONFIG };
      delete config.lintCommand;
      writeFileSync(CONFIG_FILE, JSON.stringify(config));
      expect(() => readConfig(CONFIG_FILE)).toThrow('Invalid config file');
    });

    it('throws when lintCommand has the wrong shape', () => {
      // command must be a string and args an array of strings, so a numeric
      // command fails the nested schema.
      writeFileSync(
        CONFIG_FILE,
        JSON.stringify({
          ...VALID_CONFIG,
          lintCommand: { command: 123, args: [] },
        })
      );
      expect(() => readConfig(CONFIG_FILE)).toThrow('Invalid config file');
    });

    describe('monorepoConfig', () => {
      it('round-trips a monorepoConfig, leaving absolute ignore paths unchanged', () => {
        const ignoreDir = join(tmpdir(), 'packages', 'legacy-pkg');
        createConfig({
          data: {
            ...VALID_CONFIG,
            monorepoConfig: { ignorePackagePaths: [ignoreDir] },
          },
          filePath: CONFIG_FILE,
        });
        expect(readConfig(CONFIG_FILE)).toEqual({
          ...VALID_CONFIG_READBACK,
          monorepoConfig: { ignorePackagePaths: [ignoreDir] },
        });
      });

      it('resolves relative ignorePackagePaths against the config directory', () => {
        createConfig({
          data: {
            ...VALID_CONFIG,
            monorepoConfig: {
              ignorePackagePaths: ['packages/a', 'packages/b'],
            },
          },
          filePath: CONFIG_FILE,
        });
        // Each ignore path is anchored at the config file's directory, mirroring
        // how databaseFile is resolved.
        expect(readConfig(CONFIG_FILE).monorepoConfig).toEqual({
          ignorePackagePaths: [
            resolve(dirname(CONFIG_FILE), 'packages/a'),
            resolve(dirname(CONFIG_FILE), 'packages/b'),
          ],
        });
      });

      it('rejects a monorepoConfig with an unknown field', () => {
        // The nested monorepoConfig schema is additionalProperties: false.
        writeFileSync(
          CONFIG_FILE,
          JSON.stringify({
            ...VALID_CONFIG,
            monorepoConfig: { ignorePackagePaths: [], extra: true },
          })
        );
        expect(() => readConfig(CONFIG_FILE)).toThrow('Invalid config file');
      });
    });
  });

  describe('package config overrides', () => {
    function writeOverride(contents: unknown) {
      mkdirSync(PKG_DIR, { recursive: true });
      writeFileSync(PKG_OVERRIDE_FILE, JSON.stringify(contents));
    }

    describe('getPackageSpecificConfig', () => {
      it('returns the base config unchanged when the package has no override file', () => {
        expect(
          getPackageSpecificConfig({
            packageRootDir: PKG_DIR,
            config: VALID_CONFIG,
          })
        ).toEqual(VALID_CONFIG);
      });

      it('replaces lintCommand and keeps the base non-disableable rules when the override only sets lintCommand', () => {
        writeOverride({ lintCommand: { command: 'yarn', args: ['lint:pkg'] } });
        expect(
          getPackageSpecificConfig({
            packageRootDir: PKG_DIR,
            config: VALID_CONFIG,
          })
        ).toEqual({
          ...VALID_CONFIG,
          lintCommand: { command: 'yarn', args: ['lint:pkg'] },
        });
      });

      it('appends override rules to the base non-disableable rules and keeps the base lintCommand', () => {
        writeOverride({ nonDisableableRules: ['no-eval'] });
        expect(
          getPackageSpecificConfig({
            packageRootDir: PKG_DIR,
            config: VALID_CONFIG,
          })
        ).toEqual({
          ...VALID_CONFIG,
          // The package's rules extend the repo's rules, they do not replace
          // them.
          nonDisableableRules: ['no-console', 'no-eval'],
        });
      });

      it('applies both fields when the override sets both', () => {
        writeOverride({
          lintCommand: { command: 'yarn', args: ['lint:pkg'] },
          nonDisableableRules: ['no-eval'],
        });
        expect(
          getPackageSpecificConfig({
            packageRootDir: PKG_DIR,
            config: VALID_CONFIG,
          })
        ).toEqual({
          ...VALID_CONFIG,
          lintCommand: { command: 'yarn', args: ['lint:pkg'] },
          nonDisableableRules: ['no-console', 'no-eval'],
        });
      });
    });

    describe('parsePackageConfigOverride', () => {
      it('accepts an empty object, since both fields are optional', () => {
        expect(
          parsePackageConfigOverride({
            packageConfigOverrideFileContents: '{}',
          })
        ).toEqual({});
      });

      it('rejects an unknown field', () => {
        // Repo-level-only options such as pragma are not overridable, so the
        // schema is additionalProperties: false.
        expect(() =>
          parsePackageConfigOverride({
            packageConfigOverrideFileContents: JSON.stringify({ pragma: 'P' }),
          })
        ).toThrow('Invalid package config override file');
      });

      it('rejects a wrongly-shaped field', () => {
        expect(() =>
          parsePackageConfigOverride({
            packageConfigOverrideFileContents: JSON.stringify({
              nonDisableableRules: 'no-console',
            }),
          })
        ).toThrow('Invalid package config override file');
      });

      it('exits when the override file is malformed JSON-C', () => {
        const exitSpy = mockExit();
        const errorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);

        expect(() =>
          parsePackageConfigOverride({
            packageConfigOverrideFileContents: '{ "nonDisableableRules": }',
          })
        ).toThrow('process.exit called');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to parse config file')
        );
      });
    });
  });
});
