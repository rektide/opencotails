import type { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import {
  COTAIL_LOGICAL_SCHEMA,
  CURRENT_MESSAGE_VARIANTS,
  OPENCODE_V2_SOURCE_SCHEMA,
  SourceCapabilities,
  type EventRowsCapability,
  type MessageVariant,
} from "./capabilities.ts";
import {
  IncompleteContentModelError,
  MigrationIncompleteError,
  SourceSchemaError,
  type SourceValidationError,
} from "./errors.ts";

const REQUIRED_COLUMNS = {
  session_v2: [
    "id", "project_id", "workspace_id", "parent_id", "fork_session_id", "fork_boundary", "slug",
    "directory", "path", "title", "version", "share_url", "summary_additions", "summary_deletions",
    "summary_files", "summary_diffs", "metadata", "cost", "tokens_input", "tokens_output",
    "tokens_reasoning", "tokens_cache_read", "tokens_cache_write", "revert", "permission", "agent",
    "model", "time_created", "time_updated", "time_compacting", "time_archived", "time_suspended",
  ],
  session_message: ["id", "session_id", "type", "seq", "time_created", "time_updated", "data"],
  kv: ["key", "value", "time_created", "time_updated"],
  session_pending: ["id", "session_id", "type", "data", "delivery", "admitted_seq", "time_created"],
  event_sequence: ["aggregate_id", "seq", "owner_id"],
  event: ["id", "aggregate_id", "seq", "created", "type", "data"],
} as const;

type TableName = keyof typeof REQUIRED_COLUMNS;

interface NamedRow {
  readonly name: unknown;
}

interface CountRow {
  readonly count: unknown;
}

interface TypeRow {
  readonly type: unknown;
}

function schemaError(
  reason: SourceSchemaError["reason"],
  message: string,
  table: string | null = null,
  missingColumns: readonly string[] = [],
): SourceSchemaError {
  return new SourceSchemaError({ reason, message, table, missingColumns: [...missingColumns] });
}

function inspect(database: DatabaseSync): Effect.Effect<SourceCapabilities, SourceValidationError> {
  return Effect.gen(function* () {
    const tables = new Set(
      database.prepare("select name from sqlite_master where type = 'table'").all()
        .map((row) => String((row as unknown as NamedRow).name)),
    );

    if (!tables.has("session_v2") && ["session", "message", "part"].every((table) => tables.has(table))) {
      return yield* Effect.fail(schemaError("v1-only", "OpenCode V1-only databases are not query sources"));
    }

    for (const table of ["session_v2", "session_message", "kv"] as const) {
      if (!tables.has(table)) {
        return yield* Effect.fail(schemaError("missing-table", `required V2 table ${table} is missing`, table));
      }
    }

    const hasEventSequence = tables.has("event_sequence");
    const hasEvent = tables.has("event");
    if (hasEventSequence !== hasEvent) {
      return yield* Effect.fail(schemaError(
        "incomplete-optional-layout",
        "event and event_sequence must either both exist or both be absent",
      ));
    }

    const tablesToValidate: TableName[] = ["session_v2", "session_message", "kv"];
    if (tables.has("session_pending")) tablesToValidate.push("session_pending");
    if (hasEventSequence) tablesToValidate.push("event_sequence", "event");
    for (const table of tablesToValidate) {
      const actual = new Set(
        database.prepare(`pragma table_info(${table})`).all()
          .map((row) => String((row as unknown as NamedRow).name)),
      );
      const missing = REQUIRED_COLUMNS[table].filter((column) => !actual.has(column));
      if (missing.length > 0) {
        return yield* Effect.fail(schemaError(
          "missing-columns",
          `table ${table} is missing required columns: ${missing.join(", ")}`,
          table,
          missing,
        ));
      }
    }

    const legacySessionCount = tables.has("session")
      ? Number((database.prepare("select count(*) as count from session").get() as unknown as CountRow).count)
      : 0;
    if (legacySessionCount > 0) {
      const marker = database.prepare("select value from kv where key = 'migration.v1-v2'").get() as
        | { readonly value: unknown }
        | undefined;
      let phase: string | null = null;
      try {
        const decoded: unknown = marker === undefined ? undefined : JSON.parse(String(marker.value));
        if (decoded !== null && typeof decoded === "object" && "phase" in decoded) {
          const value = (decoded as { readonly phase?: unknown }).phase;
          phase = typeof value === "string" ? value : null;
        }
      } catch {
        phase = null;
      }
      if (phase !== "completed") {
        return yield* Effect.fail(new MigrationIncompleteError({ legacySessionCount, observedPhase: phase }));
      }
    }

    const malformed = database.prepare(
      "select id from session_message where not json_valid(data) or json_type(data) <> 'object' limit 1",
    ).get();
    if (malformed !== undefined) {
      return yield* Effect.fail(schemaError(
        "malformed-message-data",
        "session_message data must be a JSON object",
        "session_message",
      ));
    }

    const observedTypes = database.prepare("select distinct type from session_message").all()
      .map((row) => String((row as unknown as TypeRow).type));
    const unknownTypes = observedTypes.filter((type) => !CURRENT_MESSAGE_VARIANTS.has(type as MessageVariant)).sort();
    if (unknownTypes.length > 0) {
      return yield* Effect.fail(new IncompleteContentModelError({ variants: unknownTypes }));
    }

    const eventRows: EventRowsCapability = hasEvent && Number(
      (database.prepare("select count(*) as count from event").get() as unknown as CountRow).count,
    ) > 0
      ? "observed"
      : "unavailable";

    return new SourceCapabilities({
      sourceSchema: OPENCODE_V2_SOURCE_SCHEMA,
      logicalSchema: COTAIL_LOGICAL_SCHEMA,
      projectedSessions: true,
      projectedMessages: true,
      pendingInput: tables.has("session_pending"),
      eventRows,
      contentModel: CURRENT_MESSAGE_VARIANTS,
    });
  });
}

export function inspectOpenCodeV2Source(
  database: DatabaseSync,
): Effect.Effect<SourceCapabilities, SourceValidationError> {
  return Effect.suspend(() => inspect(database)).pipe(
    Effect.catchDefect((cause) => Effect.fail(schemaError(
      "inspection-failed",
      cause instanceof Error ? cause.message : String(cause),
    ))),
  );
}
