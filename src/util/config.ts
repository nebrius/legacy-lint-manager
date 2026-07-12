import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parse, printParseErrorCode } from 'jsonc-parser';
import TypeBox from 'typebox';

import { error } from './logging.js';
import { validateSchema } from './validateSchema.js';

const ConfigSchema = TypeBox.Object(
  {
    lintCommand: TypeBox.Object(
      {
        command: TypeBox.String(),
        args: TypeBox.Array(TypeBox.String()),
      },
      { additionalProperties: false }
    ),
    ignoreWarnings: TypeBox.Boolean(),
    pragma: TypeBox.String(),
    databaseFile: TypeBox.String(),
    nonDisableableRules: TypeBox.Array(TypeBox.String()),
    compareBranch: TypeBox.String(),
    linterType: TypeBox.Union([
      TypeBox.Literal('eslint'),
      TypeBox.Literal('oxlint'),
    ]),
  },
  { additionalProperties: false }
);

export type Config = TypeBox.Static<typeof ConfigSchema>;

type Options = {
  data: Config;
  filePath: string;
};

export function createConfig(options: Options) {
  writeFileSync(options.filePath, JSON.stringify(options.data, null, 2));
}

export function readConfig(configFilePath: string) {
  if (!existsSync(configFilePath)) {
    error(`Config file not found: ${configFilePath}`);
    process.exit(1);
  }
  const configFileContents = readFileSync(configFilePath, 'utf-8');
  return parseConfig({ configFilePath, configFileContents });
}

export function parseConfig({
  configFilePath,
  configFileContents,
}: {
  configFilePath: string;
  configFileContents: string;
}): Config {
  // Parse the config file contents from JSON-C. jsonc-parser's parse() does not
  // throw on malformed input — it returns a best-effort partial result and
  // reports issues via the errors out-parameter, so we surface those manually.
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const config: unknown = parse(configFileContents, errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    const formatted = errors
      .map(
        (e) => `${printParseErrorCode(e.error)} at offset ${String(e.offset)}`
      )
      .join(', ');
    error(`Failed to parse config file: ${formatted}`);
    process.exit(1);
  }

  const data = validateSchema({
    schema: ConfigSchema,
    data: config,
    errorPrefix: 'Invalid config file:',
  });

  if (!isAbsolute(data.databaseFile)) {
    data.databaseFile = resolve(dirname(configFilePath), data.databaseFile);
  }

  return data;
}
