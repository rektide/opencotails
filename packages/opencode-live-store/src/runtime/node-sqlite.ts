import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import type { SqliteDatabase, SqliteStatement } from "kysely";

export class NodeSqliteStatement implements SqliteStatement {
  public readonly reader = true;
  public readonly statement: StatementSync;

  public constructor(statement: StatementSync) {
    this.statement = statement;
  }

  public all(parameters: readonly unknown[]): unknown[] {
    return this.statement.all(...parameters as SQLInputValue[]);
  }

  public iterate(parameters: readonly unknown[]): IterableIterator<unknown> {
    return this.statement.iterate(...parameters as SQLInputValue[]);
  }

  public run(parameters: readonly unknown[]): never {
    throw new Error(`read-only adapter cannot run writes (${parameters.length} parameters)`);
  }
}

export class NodeSqliteDatabase implements SqliteDatabase {
  public closed = false;
  public readonly database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.database = database;
  }

  public prepare(statement: string): SqliteStatement {
    if (this.closed) throw new Error("database closed");
    return new NodeSqliteStatement(this.database.prepare(statement));
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
