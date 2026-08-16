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
  return new SourceSchemaError({
    reason, message, table, missingColumns: [...missingColumns],
    messageID: null, messageType: null, path: null,
  });
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isInteger(value);
const string = (value: unknown): value is string => typeof value === "string";

class PayloadIssue extends Error {
  public readonly path: string;

  public constructor(path: string, message: string) {
    super(message);
    this.path = path;
  }
}

function requireAt(condition: boolean, path: string, message: string): asserts condition {
  if (!condition) throw new PayloadIssue(path, message);
}

function optional(value: unknown, check: (value: unknown) => boolean, path: string, expected: string): void {
  if (value !== undefined) requireAt(check(value), path, `expected ${expected}`);
}

function validateTime(value: unknown, path: string, completed = false): void {
  requireAt(object(value), path, "expected object");
  requireAt(finite(value.created), `${path}.created`, "expected finite number");
  if (completed) optional(value.completed, finite, `${path}.completed`, "finite number");
}

function validateMention(value: unknown, path: string): void {
  requireAt(object(value), path, "expected object");
  requireAt(finite(value.start), `${path}.start`, "expected finite number");
  requireAt(finite(value.end), `${path}.end`, "expected finite number");
  requireAt(string(value.text), `${path}.text`, "expected string");
}

function validateError(value: unknown, path: string): void {
  requireAt(object(value), path, "expected object");
  requireAt(string(value.type), `${path}.type`, "expected string");
  requireAt(string(value.message), `${path}.message`, "expected string");
  optional(value.status, (status) => integer(status) && status >= 100 && status <= 599,
    `${path}.status`, "HTTP status integer");
}

function validateModel(value: unknown, path: string): void {
  requireAt(object(value), path, "expected object");
  requireAt(string(value.id), `${path}.id`, "expected string");
  requireAt(string(value.providerID), `${path}.providerID`, "expected string");
  optional(value.variant, string, `${path}.variant`, "string");
}

function validateContent(value: unknown, path: string): void {
  requireAt(object(value), path, "expected object");
  requireAt(value.type === "text" || value.type === "file", `${path}.type`, "expected text or file");
  if (value.type === "text") requireAt(string(value.text), `${path}.text`, "expected string");
  else {
    requireAt(string(value.uri), `${path}.uri`, "expected string");
    requireAt(string(value.mime), `${path}.mime`, "expected string");
    optional(value.name, string, `${path}.name`, "string");
  }
}

function validateTool(value: Record<string, unknown>, path: string): void {
  requireAt(string(value.id), `${path}.id`, "expected string");
  requireAt(string(value.name), `${path}.name`, "expected string");
  optional(value.executed, (item) => typeof item === "boolean", `${path}.executed`, "boolean");
  optional(value.providerState, object, `${path}.providerState`, "object");
  optional(value.providerResultState, object, `${path}.providerResultState`, "object");
  validateTime(value.time, `${path}.time`, true);
  optional((value.time as Record<string, unknown>).ran, finite, `${path}.time.ran`, "finite number");
  requireAt(object(value.state), `${path}.state`, "expected object");
  const state = value.state;
  requireAt(["streaming", "running", "completed", "error"].includes(String(state.status)),
    `${path}.state.status`, "expected streaming, running, completed, or error");
  if (state.status === "streaming") requireAt(string(state.input), `${path}.state.input`, "expected string");
  else requireAt(object(state.input), `${path}.state.input`, "expected object");
  if (state.status === "running") requireAt(object(state.metadata), `${path}.state.metadata`, "expected object");
  if (state.status === "completed" || state.content !== undefined) {
    requireAt(Array.isArray(state.content) && state.content.length > 0, `${path}.state.content`, "expected non-empty array");
    state.content.forEach((item, index) => validateContent(item, `${path}.state.content[${index}]`));
  }
  if (state.status === "error") validateError(state.error, `${path}.state.error`);
  optional(state.metadata, object, `${path}.state.metadata`, "object");
}

function validateUser(value: Record<string, unknown>): void {
  requireAt(string(value.text), "$.text", "expected string");
  for (const [field, validator] of [
    ["files", (item: unknown, path: string) => {
      requireAt(object(item), path, "expected object");
      requireAt(string(item.data) && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data),
        `${path}.data`, "expected Base64 string");
      requireAt(string(item.mime), `${path}.mime`, "expected string");
      requireAt(object(item.source), `${path}.source`, "expected object");
      requireAt(item.source.type === "inline" || item.source.type === "uri", `${path}.source.type`, "expected inline or uri");
      if (item.source.type === "uri") requireAt(string(item.source.uri), `${path}.source.uri`, "expected string");
      optional(item.name, string, `${path}.name`, "string");
      optional(item.description, string, `${path}.description`, "string");
      if (item.mention !== undefined) validateMention(item.mention, `${path}.mention`);
    }],
    ["agents", (item: unknown, path: string) => {
      requireAt(object(item), path, "expected object");
      requireAt(string(item.name), `${path}.name`, "expected string");
      if (item.mention !== undefined) validateMention(item.mention, `${path}.mention`);
    }],
    ["skills", (item: unknown, path: string) => {
      requireAt(object(item), path, "expected object");
      requireAt(string(item.id), `${path}.id`, "expected string");
      requireAt(string(item.name), `${path}.name`, "expected string");
      requireAt(string(item.text), `${path}.text`, "expected string");
      if (item.mention !== undefined) validateMention(item.mention, `${path}.mention`);
    }],
  ] as const) {
    if (value[field] === undefined) continue;
    requireAt(Array.isArray(value[field]), `$.${field}`, "expected array");
    value[field].forEach((item, index) => validator(item, `$.${field}[${index}]`));
  }
}

export function validateMessagePayload(id: string, type: string, value: unknown): void {
  requireAt(id.startsWith("msg_"), "$.id", "expected msg_ ID");
  requireAt(object(value), "$", "expected object");
  requireAt(value.id === id, "$.id", `expected ${id}`);
  requireAt(value.type === type, "$.type", `expected ${type}`);
  validateTime(value.time, "$.time", type === "assistant" || type === "shell");
  optional(value.metadata, object, "$.metadata", "object");
  switch (type) {
    case "agent-switched": requireAt(string(value.agent), "$.agent", "expected string"); break;
    case "model-switched":
      validateModel(value.model, "$.model");
      if (value.previous !== undefined) validateModel(value.previous, "$.previous");
      break;
    case "user": validateUser(value); break;
    case "synthetic":
      requireAt(string(value.text), "$.text", "expected string");
      optional(value.description, string, "$.description", "string");
      break;
    case "system": requireAt(string(value.text), "$.text", "expected string"); break;
    case "skill":
      requireAt(string(value.skill), "$.skill", "expected string");
      requireAt(string(value.name), "$.name", "expected string");
      requireAt(string(value.text), "$.text", "expected string");
      break;
    case "shell": {
      requireAt(string(value.shellID) && value.shellID.startsWith("sh_"), "$.shellID", "expected sh_ ID");
      requireAt(string(value.command), "$.command", "expected string");
      requireAt(["running", "exited", "timeout", "killed"].includes(String(value.status)), "$.status", "invalid shell status");
      optional(value.exit, finite, "$.exit", "finite number");
      if (value.output !== undefined) {
        requireAt(object(value.output), "$.output", "expected object");
        requireAt(string(value.output.output), "$.output.output", "expected string");
        requireAt(integer(value.output.cursor) && value.output.cursor >= 0, "$.output.cursor", "expected non-negative integer");
        requireAt(integer(value.output.size) && value.output.size >= 0, "$.output.size", "expected non-negative integer");
        requireAt(typeof value.output.truncated === "boolean", "$.output.truncated", "expected boolean");
      }
      break;
    }
    case "assistant": {
      requireAt(string(value.agent), "$.agent", "expected string");
      validateModel(value.model, "$.model");
      requireAt(Array.isArray(value.content), "$.content", "expected array");
      value.content.forEach((item, index) => {
        const path = `$.content[${index}]`;
        requireAt(object(item), path, "expected object");
        requireAt(["text", "reasoning", "tool"].includes(String(item.type)), `${path}.type`, "invalid assistant content type");
        if (item.type === "tool") validateTool(item, path);
        else {
          requireAt(string(item.text), `${path}.text`, "expected string");
          optional(item.state, object, `${path}.state`, "object");
          if (item.type === "reasoning" && item.time !== undefined) validateTime(item.time, `${path}.time`, true);
        }
      });
      optional(value.finish, (item) => ["stop", "length", "tool-calls", "content-filter", "error", "unknown"].includes(String(item)),
        "$.finish", "finish reason");
      optional(value.cost, finite, "$.cost", "finite number");
      if (value.tokens !== undefined) {
        requireAt(object(value.tokens), "$.tokens", "expected object");
        for (const field of ["input", "output", "reasoning"] as const)
          requireAt(finite(value.tokens[field]), `$.tokens.${field}`, "expected finite number");
        requireAt(object(value.tokens.cache), "$.tokens.cache", "expected object");
        requireAt(finite(value.tokens.cache.read), "$.tokens.cache.read", "expected finite number");
        requireAt(finite(value.tokens.cache.write), "$.tokens.cache.write", "expected finite number");
      }
      if (value.error !== undefined) validateError(value.error, "$.error");
      if (value.retry !== undefined) {
        requireAt(object(value.retry), "$.retry", "expected object");
        requireAt(integer(value.retry.attempt) && value.retry.attempt > 0, "$.retry.attempt", "expected positive integer");
        requireAt(finite(value.retry.at), "$.retry.at", "expected finite number");
        validateError(value.retry.error, "$.retry.error");
      }
      if (value.snapshot !== undefined) {
        requireAt(object(value.snapshot), "$.snapshot", "expected object");
        optional(value.snapshot.start, string, "$.snapshot.start", "string");
        optional(value.snapshot.end, string, "$.snapshot.end", "string");
        optional(value.snapshot.files, (item) => Array.isArray(item) && item.every(string), "$.snapshot.files", "string array");
      }
      break;
    }
    case "compaction":
      requireAt(["running", "completed", "failed"].includes(String(value.status)), "$.status", "invalid compaction status");
      requireAt(value.reason === "auto" || value.reason === "manual", "$.reason", "expected auto or manual");
      if (value.status === "failed") validateError(value.error, "$.error");
      else {
        requireAt(string(value.summary), "$.summary", "expected string");
        requireAt(string(value.recent), "$.recent", "expected string");
      }
      break;
  }
}

export function validateStoredMessagePayload(id: unknown, type: unknown, data: unknown): string {
  const messageID = String(id);
  const messageType = String(type);
  try {
    const sourceJSON = String(data);
    const decoded: unknown = JSON.parse(sourceJSON);
    requireAt(object(decoded), "$", "expected object");
    validateMessagePayload(messageID, messageType, { ...decoded, id: messageID, type: messageType });
    return sourceJSON;
  } catch (cause) {
    const issue = cause instanceof PayloadIssue ? cause : new PayloadIssue("$", String(cause));
    throw new SourceSchemaError({
      reason: "malformed-message-payload",
      message: issue.message,
      table: "session_message",
      missingColumns: [],
      messageID,
      messageType,
      path: issue.path,
    });
  }
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
