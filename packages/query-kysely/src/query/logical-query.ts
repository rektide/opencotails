import type { InferResult, SelectQueryBuilder } from "kysely";
import type { ReadonlyQueryCreator } from "kysely/readonly";
import { Context, Effect, Stream } from "effect";
import type { SourceKey } from "../domain/address.ts";
import type { ReadProvenance } from "../domain/observation.ts";
import type { CotailRelations } from "../relations/schema.ts";
import type { LogicalRootWorld, LogicalWorldScope } from "../relations/world.ts";
import type { TrustedSourceProfileFacts } from "../profile/types.ts";
import { QueryCompileError, QueryExecutionError } from "./errors.ts";

export type AnyLogicalSelect = SelectQueryBuilder<any, any, any>;

export interface QueryContext {
  readonly db: ReadonlyQueryCreator<CotailRelations>;
  readonly world: (scope?: LogicalWorldScope) => ReadonlyQueryCreator<CotailRelations>;
  readonly rootWorld: LogicalRootWorld;
  readonly profile: TrustedSourceProfileFacts;
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

export interface LogicalRead {
  readonly source: SourceKey;
  readonly profile: TrustedSourceProfileFacts;
  readonly provenance: ReadProvenance;
  readonly all: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<Readonly<InferResult<Q>>, QueryError>;
  readonly stream: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Stream.Stream<InferResult<Q>[number], QueryError>;
  readonly explain: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<readonly SqliteQueryPlanRow[], QueryError>;
}

export interface LogicalQueryShape {
  readonly openRead: Effect.Effect<LogicalRead, QueryExecutionError, import("effect").Scope.Scope>;
  readonly compile: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<CompiledLogicalQuery<InferResult<Q>[number]>, QueryCompileError>;
}

export class LogicalQuery extends Context.Service<LogicalQuery, LogicalQueryShape>()(
  "@opencoattails/query-kysely/LogicalQuery",
) {}

export const all = <const Q extends AnyLogicalSelect>(
  query: LogicalQueryShape,
  build: (context: QueryContext) => Q,
): Effect.Effect<Readonly<InferResult<Q>>, QueryError> => Effect.scoped(
  query.openRead.pipe(Effect.flatMap((read) => read.all(build))),
);

export const stream = <const Q extends AnyLogicalSelect>(
  query: LogicalQueryShape,
  build: (context: QueryContext) => Q,
): Stream.Stream<InferResult<Q>[number], QueryError> => Stream.unwrap(
  query.openRead.pipe(Effect.map((read) => read.stream(build))),
);
