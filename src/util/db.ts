import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import TypeBox from 'typebox';
import Value from 'typebox/value';

import { InternalError } from './error.js';
import { error } from './logging.js';

const DatabaseSchema = TypeBox.Object(
  {
    ignoreWarnings: TypeBox.Optional(TypeBox.Boolean()),
    nonDisableableRules: TypeBox.Optional(TypeBox.Array(TypeBox.String())),
    ids: TypeBox.Array(TypeBox.String()),
  },
  { additionalProperties: false }
);

type DatabaseContents = TypeBox.Static<typeof DatabaseSchema>;

export function fromFile({
  databaseFile,
  createIfMissing,
}: {
  databaseFile: string;
  createIfMissing: boolean;
}) {
  if (!existsSync(databaseFile)) {
    if (createIfMissing) {
      return new DatabaseInstance(databaseFile, { ids: [] });
    }
    error(`Database file ${databaseFile} does not exist`);
    process.exit(1);
  }
  const rawdatabaseContents = JSON.parse(
    readFileSync(databaseFile, 'utf-8')
  ) as unknown;
  return new DatabaseInstance(
    databaseFile,
    validateDatabase(rawdatabaseContents)
  );
}

export function fromContents(databaseContents: unknown) {
  return new DatabaseInstance(undefined, validateDatabase(databaseContents));
}

function validateDatabase(databaseContents: unknown) {
  if (!Value.Check(DatabaseSchema, databaseContents)) {
    let errorMessage = 'Invalid database file:';
    const errors = Value.Errors(DatabaseSchema, databaseContents);
    if (errors.length === 1) {
      errorMessage += ' ' + errors[0].message;
    } else {
      for (const err of errors) {
        errorMessage += `\n  ${err.message}`;
      }
    }
    throw new Error(errorMessage);
  }
  return databaseContents;
}

class DatabaseInstance {
  private databaseFile: string | undefined;
  private database: TypeBox.Static<typeof DatabaseSchema>;

  constructor(
    databaseFile: string | undefined,
    databaseContents: DatabaseContents
  ) {
    this.databaseFile = databaseFile;
    this.database = databaseContents;

    // Make sure id order is always stable
    this.database.ids = this.database.ids.sort();
  }

  public getIds() {
    return this.database.ids;
  }

  public setIds(ids: string[]) {
    this.database.ids = ids;
  }

  public getIgnoreWarnings() {
    return this.database.ignoreWarnings ?? false;
  }

  public setIgnoreWarnings(ignoreWarnings: boolean) {
    this.database.ignoreWarnings = ignoreWarnings;
  }

  public getNonDisableableRules() {
    return this.database.nonDisableableRules ?? [];
  }

  public setNonDisableableRules(nonDisableableRules: string[]) {
    this.database.nonDisableableRules = nonDisableableRules;
  }

  public save() {
    /* v8 ignore start */
    if (!this.databaseFile) {
      throw new InternalError('this.databaseFile is undefined');
    }
    /* v8 ignore end */

    // This is only possible if this is a new database and the user didn't
    // explicitly set it via the --ignore-warnings CLI flag
    if (this.database.ignoreWarnings === undefined) {
      this.database.ignoreWarnings = false;
    }
    // This is only possible if this is a new database and the user didn't
    // explicitly set it via the --non-disableable-rules CLI flag
    if (this.database.nonDisableableRules === undefined) {
      this.database.nonDisableableRules = [];
    }
    writeFileSync(this.databaseFile, JSON.stringify(this.database));
  }
}

export type Database = InstanceType<typeof DatabaseInstance>;
