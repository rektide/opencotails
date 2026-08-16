import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { SqliteDatabase, SqliteStatement } from "kysely";
import { Kysely, SqliteDialect } from "kysely";
import { Effect, Schema } from "effect";
import { sourceKey, type SourceKey } from "../domain/address.ts";
import { makeLogicalQuery, type LogicalQueryShape } from "../query/logical-query.ts";
import { logicalWorld } from "../relations/world.ts";
import type { PhysicalOpenCodeV2 } from "../source/contracts.ts";
import type { SourceCapabilities } from "../source/capabilities.ts";
import type { SourceValidationError } from "../source/errors.ts";
import { inspectOpenCodeV2Source } from "../source/validation.ts";

export class SourceOpenError extends Schema.TaggedErrorClass<SourceOpenError>()(
  "SourceOpenError",
  { path: Schema.String, message: Schema.String },
) {}

export interface NodeOpenCodeSourceConfig {
  readonly path: string;
  readonly sourceID: string;
}

export interface NodeOpenCodeSource {
  readonly query: LogicalQueryShape;
  readonly capabilities: SourceCapabilities;
  readonly source: SourceKey;
  readonly closed: boolean;
}

function isReadStatement(statement: string): boolean {
  let depth = 0;
  let quote: "'" | '"' | "`" | "]" | undefined;
  const words: string[] = [];
  for (let index = 0; index < statement.length;) {
    const character = statement[index]!;
    if (quote !== undefined) {
      if (character === quote) {
        if (statement[index + 1] === quote && quote !== "]") index += 2;
        else { quote = undefined; index++; }
      } else index++;
      continue;
    }
    if (character === "'" || character === '"' || character === "`" || character === "[") {
      quote = character === "[" ? "]" : character;
      index++;
      continue;
    }
    if (character === "-" && statement[index + 1] === "-") {
      const end = statement.indexOf("\n", index + 2);
      index = end < 0 ? statement.length : end;
      continue;
    }
    if (character === "/" && statement[index + 1] === "*") {
      const end = statement.indexOf("*/", index + 2);
      index = end < 0 ? statement.length : end + 2;
      continue;
    }
    if (character === "(") { depth++; index++; continue; }
    if (character === ")") { depth--; index++; continue; }
    if (depth === 0 && /[A-Za-z]/.test(character)) {
      const word = /^[A-Za-z]+/.exec(statement.slice(index))![0]!;
      words.push(word.toLowerCase());
      index += word.length;
      continue;
    }
    index++;
  }
  if (words[0] === "select" || words[0] === "explain") return true;
  return words[0] === "with"
    && words.slice(1).includes("select")
    && !words.slice(1).some((word) => ["insert", "update", "delete", "replace"].includes(word));
}

export class ReadonlyNodeSqliteStatement implements SqliteStatement {
  public readonly reader: boolean;
  public readonly statement: StatementSync;

  public constructor(
    statement: StatementSync,
    sql: string,
  ) {
    this.statement = statement;
    this.reader = isReadStatement(sql);
  }

  public all(parameters: readonly unknown[]): unknown[] {
    if (!this.reader) throw new Error("read-only adapter cannot run writes");
    return this.statement.all(...parameters as SQLInputValue[]);
  }

  public iterate(parameters: readonly unknown[]): IterableIterator<unknown> {
    if (!this.reader) throw new Error("read-only adapter cannot run writes");
    return this.statement.iterate(...parameters as SQLInputValue[]);
  }

  public run(_parameters: readonly unknown[]): never {
    throw new Error("read-only adapter cannot run writes");
  }
}

export class ReadonlyNodeSqliteDatabase implements SqliteDatabase {
  public closed = false;
  public readonly database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.database = database;
  }

  public prepare(sql: string): SqliteStatement {
    if (this.closed) throw new Error("database closed");
    return new ReadonlyNodeSqliteStatement(this.database.prepare(sql), sql);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}

interface AcquiredNodeSource {
  readonly native: DatabaseSync;
  readonly adapter: ReadonlyNodeSqliteDatabase;
  readonly physical: Kysely<PhysicalOpenCodeV2>;
}

function acquire(config: NodeOpenCodeSourceConfig): Effect.Effect<AcquiredNodeSource, SourceOpenError> {
  return Effect.try({
    try: () => {
      let native: DatabaseSync | undefined;
      try {
        native = new DatabaseSync(config.path, { readOnly: true });
        native.exec("PRAGMA query_only = ON");
        native.function("regexp", { deterministic: true }, (pattern: unknown, value: unknown) =>
          typeof pattern === "string" && typeof value === "string" && new RegExp(pattern, "u").test(value) ? 1 : 0);
        const adapter = new ReadonlyNodeSqliteDatabase(native);
        const physical = new Kysely<PhysicalOpenCodeV2>({
          dialect: new SqliteDialect({ database: adapter }),
        });
        return { native, adapter, physical };
      } catch (cause) {
        native?.close();
        throw cause;
      }
    },
    catch: (cause) => new SourceOpenError({
      path: config.path,
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  });
}

export function acquireNodeOpenCodeSource(
  config: NodeOpenCodeSourceConfig,
): Effect.Effect<NodeOpenCodeSource, SourceOpenError | SourceValidationError, import("effect").Scope.Scope> {
  return Effect.acquireRelease(
    acquire(config),
    ({ adapter }) => Effect.sync(() => adapter.close()),
  ).pipe(
    Effect.flatMap((resource) => inspectOpenCodeV2Source(resource.native).pipe(
      Effect.map((capabilities) => {
        const source = sourceKey(config.sourceID);
        const query = makeLogicalQuery({
          context: { db: logicalWorld(resource.physical), capabilities, source },
          executor: {
            execute: (sql, parameters) => resource.adapter.prepare(sql).all(parameters),
          },
        });
        const exposed: NodeOpenCodeSource = {
          query,
          capabilities,
          source,
          get closed() { return resource.adapter.closed; },
        };
        return Object.freeze(exposed);
      }),
    )),
  );
}
