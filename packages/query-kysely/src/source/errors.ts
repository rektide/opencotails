import { Schema } from "effect";

export const SourceSchemaReason = Schema.Literals([
  "v1-only",
  "missing-table",
  "incomplete-optional-layout",
  "missing-columns",
  "malformed-message-data",
  "inspection-failed",
]);
export type SourceSchemaReason = typeof SourceSchemaReason.Type;

export class SourceSchemaError extends Schema.TaggedErrorClass<SourceSchemaError>()(
  "SourceSchemaError",
  {
    reason: SourceSchemaReason,
    message: Schema.String,
    table: Schema.NullOr(Schema.String),
    missingColumns: Schema.Array(Schema.String),
  },
) {}

export class MigrationIncompleteError extends Schema.TaggedErrorClass<MigrationIncompleteError>()(
  "MigrationIncompleteError",
  {
    legacySessionCount: Schema.Number,
    observedPhase: Schema.NullOr(Schema.String),
  },
) {}

export class IncompleteContentModelError extends Schema.TaggedErrorClass<IncompleteContentModelError>()(
  "IncompleteContentModelError",
  { variants: Schema.Array(Schema.String) },
) {}

export type SourceValidationError =
  | SourceSchemaError
  | MigrationIncompleteError
  | IncompleteContentModelError;
