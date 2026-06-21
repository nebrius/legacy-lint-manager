import { readFileSync, writeFileSync } from 'node:fs';

import TypeBox from 'typebox';
import Value from 'typebox/value';

const DatabaseSchema = TypeBox.Object(
  {
    ids: TypeBox.Array(TypeBox.String()),
  },
  { additionalProperties: false }
);

export class Database {
  private databaseFile: string;
  private database: TypeBox.Static<typeof DatabaseSchema>;

  constructor(databaseFile: string) {
    this.databaseFile = databaseFile;
    const databaseContents = JSON.parse(
      readFileSync(databaseFile, 'utf-8')
    ) as unknown;
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
    this.database = databaseContents;
    this.database.ids = this.database.ids.sort();
  }

  public getIds() {
    return this.database.ids;
  }

  public setIds(ids: string[]) {
    this.database.ids = ids;
  }

  public saveDatabase() {
    writeFileSync(this.databaseFile, JSON.stringify(this.database));
  }
}
