import { Schema } from "effect";

export class QueryCompileError extends Schema.TaggedErrorClass<QueryCompileError>()(
  "QueryCompileError",
  { message: Schema.String },
) {}

export class QueryExecutionError extends Schema.TaggedErrorClass<QueryExecutionError>()(
  "QueryExecutionError",
  { message: Schema.String },
) {}
