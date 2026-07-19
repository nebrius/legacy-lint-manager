import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { parse, printParseErrorCode } from 'jsonc-parser';
import TypeBox from 'typebox';

import { DEFAULT_CONFIG_FILE_NAME } from './constants.js';
import { error } from './logging.js';
import { validateSchema } from './validateSchema.js';

const LintCommandSchema = TypeBox.Object(
  {
    command: TypeBox.String(),
    args: TypeBox.Array(TypeBox.String()),
  },
  { additionalProperties: false }
);

const ConfigSchema = TypeBox.Object(
  {
    lintCommand: LintCommandSchema,
    ignoreWarnings: TypeBox.Boolean(),
    pragma: TypeBox.String(),
    databaseFile: TypeBox.String(),
    nonDisableableRules: TypeBox.Array(TypeBox.String()),
    compareBranch: TypeBox.String(),
    // The presense or absence of this object indicates whether or not this
    // config enables monorepo mode
    monorepoConfig: TypeBox.Optional(
      TypeBox.Object(
        {
          ignorePackagePaths: TypeBox.Array(TypeBox.String()),
        },
        { additionalProperties: false }
      )
    ),
    linterType: TypeBox.Union([
      TypeBox.Literal('eslint'),
      TypeBox.Literal('oxlint'),
    ]),
  },
  { additionalProperties: false }
);

export type Config = TypeBox.Static<typeof ConfigSchema>;

const PackageConfigOverrideSchema = TypeBox.Object(
  {
    lintCommand: TypeBox.Optional(LintCommandSchema),
    nonDisableableRules: TypeBox.Optional(TypeBox.Array(TypeBox.String())),
  },
  { additionalProperties: false }
);

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
  const config = parseJSONCFile(configFileContents);

  const data = validateSchema({
    schema: ConfigSchema,
    data: config,
    errorPrefix: 'Invalid config file:',
  });

  if (!isAbsolute(data.databaseFile)) {
    data.databaseFile = resolve(dirname(configFilePath), data.databaseFile);
  }
  if (data.monorepoConfig) {
    for (let i = 0; i < data.monorepoConfig.ignorePackagePaths.length; i++) {
      const ignorePath = data.monorepoConfig.ignorePackagePaths[i];
      // If this is a wildcard path, make sure the wildcard is at the end
      const firstWildcardIndex = ignorePath.indexOf('*');
      if (
        firstWildcardIndex !== -1 &&
        firstWildcardIndex !== ignorePath.length - 1
      ) {
        error(
          `Wildcards in ignore package paths must only be at the end: ${ignorePath}`
        );
        process.exit(1);
      }
      if (firstWildcardIndex !== -1 && !ignorePath.endsWith('/*')) {
        error(
          `Wildcard in ignore package path must be preceded by a forward slash, e.g. "ignored/*", not "ignored*": ${ignorePath}`
        );
        process.exit(1);
      }

      // Wildcard patterns are allowed in isAbsolute/resolve, so nothing special needed
      if (!isAbsolute(ignorePath)) {
        data.monorepoConfig.ignorePackagePaths[i] = resolve(
          dirname(configFilePath),
          ignorePath
        );
      }
    }
  }

  return data;
}

export function getPackageSpecificConfig({
  packageRootDir,
  config,
}: {
  packageRootDir: string;
  config: Config;
}): Config {
  // Package config override names cannot be configured, so we always use
  // the default name instead
  const packageConfigOverrideFilePath = join(
    packageRootDir,
    DEFAULT_CONFIG_FILE_NAME
  );
  if (!existsSync(packageConfigOverrideFilePath)) {
    return config;
  }

  const packageConfigOverride = readPackageConfigOverride(
    packageConfigOverrideFilePath
  );
  return {
    ...config,
    ...packageConfigOverride,
    nonDisableableRules: [
      ...config.nonDisableableRules,
      ...(packageConfigOverride.nonDisableableRules ?? []),
    ],
  };
}

// Note: consumers must check file existence before calling this function,
// unlike readConfig(). In practice they always do implicitly since these file
// paths are created through querying the file-system, unlike the main config
// which comes from an arg.
export function readPackageConfigOverride(
  packageConfigOverrideFilePath: string
) {
  const packageConfigOverrideFileContents = readFileSync(
    packageConfigOverrideFilePath,
    'utf-8'
  );
  return parsePackageConfigOverride({
    packageConfigOverrideFileContents,
  });
}

export function parsePackageConfigOverride({
  packageConfigOverrideFileContents,
}: {
  packageConfigOverrideFileContents: string;
}) {
  const config = parseJSONCFile(packageConfigOverrideFileContents);

  return validateSchema({
    schema: PackageConfigOverrideSchema,
    data: config,
    errorPrefix: 'Invalid package config override file:',
  });
}

function parseJSONCFile(fileContents: string) {
  // Parse the config file contents from JSON-C. jsonc-parser's parse() does not
  // throw on malformed input — it returns a best-effort partial result and
  // reports issues via the errors out-parameter, so we surface those manually.
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const config: unknown = parse(fileContents, errors, {
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
  return config;
}
