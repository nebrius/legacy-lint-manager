import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import TypeBox from 'typebox';
import Value from 'typebox/value';

import { InternalError } from './error.js';

const DatabaseSchema = TypeBox.Object(
  {
    ids: TypeBox.Array(TypeBox.String()),
  },
  { additionalProperties: false }
);

type DatabaseContents = TypeBox.Static<typeof DatabaseSchema>;

export function fromFile(databaseFile: string) {
  if (!existsSync(databaseFile)) {
    return new DatabaseInstance(databaseFile, { ids: [] });
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

  public save() {
    if (!this.databaseFile) {
      throw new InternalError('this.databaseFile is undefined');
    }
    writeFileSync(this.databaseFile, JSON.stringify(this.database));
  }
}

export type Database = InstanceType<typeof DatabaseInstance>;
