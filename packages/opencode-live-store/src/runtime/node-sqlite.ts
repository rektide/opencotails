import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import type { SqliteDatabase, SqliteStatement } from "kysely";

function isReadStatement(sql: string): boolean {
  let depth = 0;
  let quote: "'" | '"' | "`" | "]" | undefined;
  const topLevelWords: string[] = [];
  for (let index = 0; index < sql.length;) {
    const character = sql[index]!;
    if (quote !== undefined) {
      const end = quote === "]" ? "]" : quote;
      if (character === end) {
        if (sql[index + 1] === end && quote !== "]") index += 2;
        else { quote = undefined; index++; }
      } else index++;
      continue;
    }
    if (character === "'" || character === '"' || character === "`" || character === "[") {
      quote = character === "[" ? "]" : character;
      index++;
      continue;
    }
    if (character === "-" && sql[index + 1] === "-") {
      index = sql.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (character === "(") { depth++; index++; continue; }
    if (character === ")") { depth--; index++; continue; }
    if (depth === 0 && /[A-Za-z]/.test(character)) {
      const match = /^[A-Za-z]+/.exec(sql.slice(index))!;
      topLevelWords.push(match[0]!.toLowerCase());
      index += match[0]!.length;
      continue;
    }
    index++;
  }
  if (topLevelWords[0] === "select" || topLevelWords[0] === "explain") return true;
  if (topLevelWords[0] !== "with") return false;
  return topLevelWords.slice(1).some((word) => word === "select")
    && !topLevelWords.slice(1).some((word) => ["insert", "update", "delete", "replace"].includes(word));
}

export class NodeSqliteStatement implements SqliteStatement {
  public readonly reader: boolean;
  public readonly statement: StatementSync;

  public constructor(statement: StatementSync, sql = "select") {
    this.statement = statement;
    this.reader = isReadStatement(sql);
  }

  public all(parameters: readonly unknown[]): unknown[] {
    if (!this.reader) throw new Error(`read-only adapter cannot run writes (${parameters.length} parameters)`);
    return this.statement.all(...parameters as SQLInputValue[]);
  }

  public iterate(parameters: readonly unknown[]): IterableIterator<unknown> {
    if (!this.reader) throw new Error(`read-only adapter cannot run writes (${parameters.length} parameters)`);
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
    return new NodeSqliteStatement(this.database.prepare(statement), statement);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
