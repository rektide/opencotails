import type { InferResult, SelectQueryBuilder } from "kysely";
import type { ReadonlyQueryCreator } from "kysely/readonly";
import { Context, Effect } from "effect";
import type { SourceKey } from "../domain/address.ts";
import type { CotailRelations } from "../relations/schema.ts";
import type { SourceCapabilities } from "../source/capabilities.ts";
import { QueryCompileError, QueryExecutionError } from "./errors.ts";

export type AnyLogicalSelect = SelectQueryBuilder<CotailRelations, keyof CotailRelations, unknown>;

export interface QueryContext {
  readonly db: ReadonlyQueryCreator<CotailRelations>;
  readonly capabilities: SourceCapabilities;
  readonly source: SourceKey;
}

export interface CompiledLogicalQuery<Row> {
  readonly sql: string;
  readonly parameters: readonly unknown[];
  readonly _row?: Row;
}

export interface SqliteQueryPlanRow {
  readonly id: number;
  readonly parent: number;
  readonly notused: number;
  readonly detail: string;
}

export type QueryError = QueryCompileError | QueryExecutionError;

export interface LogicalQueryShape {
  readonly run: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<Readonly<InferResult<Q>>, QueryError>;
  readonly compile: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<CompiledLogicalQuery<InferResult<Q>[number]>, QueryCompileError>;
  readonly explainQueryPlan: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<readonly SqliteQueryPlanRow[], QueryError>;
}

export class LogicalQuery extends Context.Service<LogicalQuery, LogicalQueryShape>()(
  "@opencoattails/query-kysely/LogicalQuery",
) {}

export interface LogicalQueryExecutor {
  readonly execute: (sql: string, parameters: readonly unknown[]) => readonly unknown[];
}

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

export function makeLogicalQuery(input: {
  readonly context: QueryContext;
  readonly executor: LogicalQueryExecutor;
}): LogicalQueryShape {
  const compile = <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ): Effect.Effect<CompiledLogicalQuery<InferResult<Q>[number]>, QueryCompileError> =>
    Effect.try({
      try: () => {
        const compiled = build(input.context).compile();
        return Object.freeze({
          sql: compiled.sql,
          parameters: Object.freeze([...compiled.parameters]),
        });
      },
      catch: (cause) => new QueryCompileError({ message: message(cause) }),
    });

  return LogicalQuery.of(Object.freeze({
    compile,
    run: <const Q extends AnyLogicalSelect>(build: (context: QueryContext) => Q) =>
      compile(build).pipe(
        Effect.flatMap((compiled) => Effect.try({
          try: () => input.executor.execute(compiled.sql, compiled.parameters) as Readonly<InferResult<Q>>,
          catch: (cause) => new QueryExecutionError({ message: message(cause) }),
        })),
      ),
    explainQueryPlan: <const Q extends AnyLogicalSelect>(build: (context: QueryContext) => Q) =>
      compile(build).pipe(
        Effect.flatMap((compiled) => Effect.try({
          try: () => input.executor.execute(
            `EXPLAIN QUERY PLAN ${compiled.sql}`,
            compiled.parameters,
          ) as readonly SqliteQueryPlanRow[],
          catch: (cause) => new QueryExecutionError({ message: message(cause) }),
        })),
      ),
  }));
}
