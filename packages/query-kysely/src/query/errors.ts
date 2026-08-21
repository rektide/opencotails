import { Schema } from "effect";

export class QueryCompileError extends Schema.TaggedErrorClass<QueryCompileError>()(
  "QueryCompileError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

export const QueryExecutionPhase = Schema.Literals(["begin", "pin", "prepare", "step", "explain"]);
export type QueryExecutionPhase = typeof QueryExecutionPhase.Type;

export const QueryExecutionReason = Schema.Literals(["sqlite", "busy", "locked", "read-scope-busy"]);
export type QueryExecutionReason = typeof QueryExecutionReason.Type;

export class QueryExecutionError extends Schema.TaggedErrorClass<QueryExecutionError>()(
  "QueryExecutionError",
  {
    source: Schema.Struct({
      kind: Schema.Literal("opencode-v2"),
      sourceID: Schema.String,
    }),
    phase: QueryExecutionPhase,
    reason: QueryExecutionReason,
    message: Schema.String,
    code: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}
