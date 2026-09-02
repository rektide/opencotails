import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { SqliteDatabase, SqliteStatement } from "kysely";
import { type InferResult, Kysely, SqliteDialect } from "kysely";
import { Effect, Schema, Semaphore, Stream } from "effect";
import { sourceKey, type SourceKey } from "../domain/address.ts";
import { ReadScopeID, readProvenance } from "../domain/observation.ts";
import {
  LogicalQuery,
  type AnyLogicalSelect,
  type CompiledLogicalQuery,
  type LogicalQueryShape,
  type LogicalRead,
  type QueryContext,
  type SqliteQueryPlanRow,
} from "../query/logical-query.ts";
import {
  QueryCompileError,
  QueryExecutionError,
  type QueryExecutionPhase,
  type QueryExecutionReason,
} from "../query/errors.ts";
import {
  logicalRootWorld,
  logicalWorld,
  type LogicalRootMessageScope,
  type LogicalRootWorld,
} from "../relations/world.ts";
import type { PhysicalOpenCodeV2 } from "../source/contracts.ts";
import type { TrustedSourceProfileFacts } from "../profile/types.ts";
import { validateStoredMessagePayload } from "../source/validation.ts";

export class SourceOpenError extends Schema.TaggedErrorClass<SourceOpenError>()(
  "SourceOpenError",
  { path: Schema.String, message: Schema.String },
) {}

export interface NodeOpenCodeSourceConfig {
  readonly path: string;
  readonly sourceID: string;
  readonly profile: TrustedSourceProfileFacts;
  readonly busyTimeoutMs?: number;
  readonly onPayloadValidation?: (messageID: string, messageType: string) => void;
}

export interface NodeOpenCodeSource {
  readonly query: LogicalQueryShape;
  readonly profile: TrustedSourceProfileFacts;
  readonly capabilities: TrustedSourceProfileFacts["capabilities"];
  readonly source: SourceKey;
  readonly closed: boolean;
}

export class ReadonlyNodeSqliteStatement implements SqliteStatement {
  public readonly reader: boolean;
  public readonly statement: StatementSync;

  public constructor(
    statement: StatementSync,
  ) {
    this.statement = statement;
    this.reader = statement.columns().length > 0;
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

  public constructor(
    database: DatabaseSync,
    onPayloadValidation?: (messageID: string, messageType: string) => void,
  ) {
    this.database = database;
    database.function("regexp", { deterministic: true }, (pattern: unknown, value: unknown, flags: unknown) =>
      typeof pattern === "string" && typeof value === "string" && typeof flags === "string"
        && new RegExp(pattern, `${flags}u`).test(value) ? 1 : 0);
    database.function("cotail_validate_message", { deterministic: true }, (id, type, data) => {
      onPayloadValidation?.(String(id), String(type));
      return validateStoredMessagePayload(id, type, data);
    });
  }

  public prepare(sql: string): SqliteStatement {
    if (this.closed) throw new Error("database closed");
    return new ReadonlyNodeSqliteStatement(this.database.prepare(sql));
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

export type NodeSqliteTestAction =
  | "begin"
  | "rollback"
  | "prepare"
  | "step"
  | "iterator-return"
  | "close";

interface NodeSqliteTestHooks {
  readonly onAction: (action: NodeSqliteTestAction) => void;
}

function acquire(
  config: NodeOpenCodeSourceConfig,
): Effect.Effect<AcquiredNodeSource, SourceOpenError> {
  return Effect.try({
    try: () => {
      let native: DatabaseSync | undefined;
      try {
        native = new DatabaseSync(config.path, { readOnly: true, timeout: config.busyTimeoutMs ?? 5_000 });
        native.exec("PRAGMA query_only = ON");
        const adapter = new ReadonlyNodeSqliteDatabase(native, config.onPayloadValidation);
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

type ReadState = "open" | "statement-active" | "closed";

export class ReadScopeClosed extends Error {
  public readonly source: SourceKey;

  public constructor(source: SourceKey) {
    super(`read scope for ${source.sourceID} is closed`);
    this.name = "ReadScopeClosed";
    this.source = source;
  }
}

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

function sqliteCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

function sqliteReason(cause: unknown): QueryExecutionReason {
  const value = cause as { readonly errcode?: unknown; readonly message?: unknown };
  if (value.errcode === 5 || (typeof value.message === "string" && /\bbusy\b/i.test(value.message))) return "busy";
  if (value.errcode === 6 || (typeof value.message === "string" && /\blocked\b/i.test(value.message))) return "locked";
  return "sqlite";
}

function executionError(source: SourceKey, phase: QueryExecutionPhase, cause: unknown): QueryExecutionError {
  const code = sqliteCode(cause);
  return new QueryExecutionError({
    source,
    phase,
    reason: sqliteReason(cause),
    message: message(cause),
    ...(code === undefined ? {} : { code }),
    cause,
  });
}

function makeNodeLogicalQuery(input: {
  readonly native: DatabaseSync;
  readonly context: QueryContext;
  readonly semaphore: Semaphore.Semaphore;
  readonly hooks?: NodeSqliteTestHooks;
}): LogicalQueryShape {
  const { context, hooks, native, semaphore } = input;
  const compile = <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ): Effect.Effect<CompiledLogicalQuery<InferResult<Q>[number]>, QueryCompileError> => Effect.try({
    try: () => {
      const compiled = build(context).compile();
      return Object.freeze({
        sql: compiled.sql,
        parameters: Object.freeze([...compiled.parameters]),
      });
    },
    catch: (cause) => new QueryCompileError({ message: message(cause), cause }),
  });

  const openRead = Effect.gen(function*() {
    yield* Effect.uninterruptibleMask((restore) => restore(semaphore.take(1)).pipe(
      Effect.tap(() => Effect.addFinalizer(() => semaphore.release(1).pipe(Effect.asVoid))),
      Effect.asVoid,
    ));

    let state: ReadState = "open";
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          hooks?.onAction("begin");
          native.exec("BEGIN DEFERRED");
        },
        catch: (cause) => executionError(context.source, "begin", cause),
      }),
      () => Effect.sync(() => {
        try {
          try {
            hooks?.onAction("rollback");
          } finally {
            native.exec("ROLLBACK");
          }
        } finally {
          state = "closed";
        }
      }),
    );
    const provenance = readProvenance(ReadScopeID.make(randomUUID()), Date.now());
    const acquireSlot = Effect.suspend(() => {
      if (state === "closed") return Effect.die(new ReadScopeClosed(context.source));
      if (state === "statement-active") {
        return Effect.fail(new QueryExecutionError({
          source: context.source,
          phase: "prepare",
          reason: "read-scope-busy",
          message: `read scope for ${context.source.sourceID} already has an active statement`,
        }));
      }
      state = "statement-active";
      return Effect.void;
    });
    const releaseSlot = () => Effect.sync(() => {
      if (state === "statement-active") state = "open";
    });

    const all = <const Q extends AnyLogicalSelect>(build: (context: QueryContext) => Q) =>
      Effect.acquireUseRelease(
        acquireSlot,
        () => compile(build).pipe(
          Effect.flatMap((compiled) => Effect.try({
            try: () => {
              hooks?.onAction("prepare");
              return native.prepare(compiled.sql);
            },
            catch: (cause) => executionError(context.source, "prepare", cause),
          }).pipe(Effect.map((statement) => ({ statement, compiled })))),
          Effect.flatMap(({ statement, compiled }) => Effect.try({
            try: () => {
              hooks?.onAction("step");
              return statement.all(...compiled.parameters as SQLInputValue[]) as unknown as Readonly<InferResult<Q>>;
            },
            catch: (cause) => executionError(context.source, "step", cause),
          })),
        ),
        releaseSlot,
      );

    const explain = <const Q extends AnyLogicalSelect>(build: (context: QueryContext) => Q) =>
      Effect.acquireUseRelease(
        acquireSlot,
        () => compile(build).pipe(
          Effect.flatMap((compiled) => Effect.try({
            try: () => {
              hooks?.onAction("prepare");
              return native.prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`);
            },
            catch: (cause) => executionError(context.source, "explain", cause),
          }).pipe(Effect.map((statement) => ({ statement, compiled })))),
          Effect.flatMap(({ statement, compiled }) => Effect.try({
            try: () => {
              hooks?.onAction("step");
              return statement.all(...compiled.parameters as SQLInputValue[]) as unknown as readonly SqliteQueryPlanRow[];
            },
            catch: (cause) => executionError(context.source, "explain", cause),
          })),
        ),
        releaseSlot,
      );

    const stream = <const Q extends AnyLogicalSelect>(build: (context: QueryContext) => Q) => Stream.scoped(
      Stream.fromEffect(Effect.acquireRelease(
        acquireSlot,
        releaseSlot,
      )).pipe(
        Stream.flatMap(() => Stream.fromEffect(Effect.acquireRelease(
          compile(build).pipe(
            Effect.flatMap((compiled) => Effect.try({
              try: () => {
                hooks?.onAction("prepare");
                return native.prepare(compiled.sql);
              },
              catch: (cause) => executionError(context.source, "prepare", cause),
            }).pipe(Effect.map((statement) => ({ statement, compiled })))),
            Effect.flatMap(({ statement, compiled }) => Effect.try({
              try: () => statement.iterate(...compiled.parameters as SQLInputValue[]),
              catch: (cause) => executionError(context.source, "step", cause),
            })),
          ),
          (iterator) => Effect.sync(() => {
            hooks?.onAction("iterator-return");
            iterator.return?.();
          }),
        )).pipe(
          Stream.flatMap((iterator) => Stream.unfold(iterator, (current) => Effect.try({
            try: () => {
              hooks?.onAction("step");
              const next = current.next();
              return next.done ? undefined : [next.value as InferResult<Q>[number], current] as const;
            },
            catch: (cause) => executionError(context.source, "step", cause),
          }))),
        )),
      ),
    );

    const read: LogicalRead = Object.freeze({
      source: context.source,
      profile: context.profile,
      provenance,
      all,
      stream,
      explain,
    });
    return read;
  });

  return LogicalQuery.of(Object.freeze({ compile, openRead }));
}

function acquireNodeOpenCodeSourceWithHooks(
  config: NodeOpenCodeSourceConfig,
  hooks?: NodeSqliteTestHooks,
): Effect.Effect<NodeOpenCodeSource, SourceOpenError, import("effect").Scope.Scope> {
  return Effect.acquireRelease(
    acquire(config),
    ({ adapter }) => Effect.sync(() => {
      adapter.close();
      hooks?.onAction("close");
    }),
  ).pipe(Effect.flatMap((resource) => Semaphore.make(1).pipe(Effect.map((semaphore) => {
    const source = sourceKey(config.sourceID);
    const world = (scope = {}) => logicalWorld(resource.physical, scope);
    const rootWorld = ((scope?: LogicalRootMessageScope) => scope === undefined
      ? logicalRootWorld(resource.physical)
      : logicalRootWorld(resource.physical, scope)) as LogicalRootWorld;
    const query = makeNodeLogicalQuery({
      native: resource.native,
      context: { db: world(), world, rootWorld, profile: config.profile, source },
      semaphore,
      hooks,
    });
    const exposed: NodeOpenCodeSource = {
      query,
      profile: config.profile,
      capabilities: config.profile.capabilities,
      source,
      get closed() { return resource.adapter.closed; },
    };
    return Object.freeze(exposed);
  }))));
}

export function acquireNodeOpenCodeSource(
  config: NodeOpenCodeSourceConfig,
): Effect.Effect<NodeOpenCodeSource, SourceOpenError, import("effect").Scope.Scope> {
  return acquireNodeOpenCodeSourceWithHooks(config);
}

/** @internal Test-only lifecycle instrumentation; not exported from the package root. */
export function acquireNodeOpenCodeSourceForTest(
  config: NodeOpenCodeSourceConfig,
  onAction: (action: NodeSqliteTestAction) => void,
): Effect.Effect<NodeOpenCodeSource, SourceOpenError, import("effect").Scope.Scope> {
  return acquireNodeOpenCodeSourceWithHooks(config, { onAction });
}
