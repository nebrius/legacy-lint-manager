import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import TypeBox from 'typebox';

import { InternalError } from './error.js';
import { error } from './logging.js';
import { validateSchema } from './validateSchema.js';

const DatabaseSchema = TypeBox.Array(TypeBox.String());

type DatabaseContents = TypeBox.Static<typeof DatabaseSchema>;

export function readDatabase(databaseFile: string) {
  if (!existsSync(databaseFile)) {
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

export function createDatabase({
  filePath,
  databaseContents,
}: {
  filePath: string | undefined;
  databaseContents: unknown;
}) {
  return new DatabaseInstance(filePath, validateDatabase(databaseContents));
}

function validateDatabase(databaseContents: unknown) {
  return validateSchema({
    schema: DatabaseSchema,
    data: databaseContents,
    errorPrefix: 'Invalid database file:',
  });
}

class DatabaseInstance {
  private databaseFile: string | undefined;
  private database: TypeBox.Static<typeof DatabaseSchema>;

  constructor(
    databaseFile: string | undefined,
    databaseContents: DatabaseContents
  ) {
    this.databaseFile = databaseFile;
    this.database = databaseContents.sort();
  }

  public getIds() {
    return this.database;
  }

  public setIds(ids: string[]) {
    this.database = ids.sort();
  }

  public save() {
    /* v8 ignore start */
    if (!this.databaseFile) {
      throw new InternalError('this.databaseFile is undefined');
    }
    /* v8 ignore end */
    writeFileSync(this.databaseFile, JSON.stringify(this.database));
  }
}

export type Database = InstanceType<typeof DatabaseInstance>;
