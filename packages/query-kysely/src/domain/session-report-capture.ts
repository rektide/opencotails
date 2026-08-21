import { Option, Schema, SchemaAST, SchemaIssue } from "effect";
import {
  sessionAddress,
  sourceKey,
  target,
  type SessionAddress,
  type Target,
} from "./address.ts";
import { sessionID } from "./identifier.ts";
import type { SessionReport, SessionReportObservation } from "./session-report.ts";

/** Durable schema identifier of the versioned Session report capture wire value. */
export const sessionReportCaptureSchema = "cotail.session-report.capture/v1" as const;

/**
 * Storage-neutral, versioned capture of one canonical Session report.
 *
 * The value itself is the durable wire form: it is directly JSON-serializable,
 * JSON round trips preserve exact counter integers and cost precision, and it
 * deliberately carries no read provenance. `ReadScopeID` correlates live
 * observations from one pinned read but is not a source revision and can never
 * detect later change; `guard.updatedAt` is the honest comparison token.
 */
export interface SessionReportCapture {
  readonly schema: typeof sessionReportCaptureSchema;
  readonly capturedAt: number;
  readonly target: Target<SessionAddress>;
  readonly report: SessionReport;
  readonly guard: { readonly updatedAt: number };
}

export class SessionReportCaptureDecodeError extends Error {
  /** The `schema` string carried by the rejected input, when readable. */
  public readonly observedSchema: string | null;
  public readonly cause: unknown;

  public constructor(input: unknown, cause: unknown) {
    const observed = typeof input === "object" && input !== null && "schema" in input
      && typeof (input as { readonly schema: unknown }).schema === "string"
        ? (input as { readonly schema: string }).schema
        : null;
    super(
      `invalid SessionReportCapture${observed === null ? "" : ` (schema ${observed})`}: `
        + (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = "SessionReportCaptureDecodeError";
    this.observedSchema = observed;
    this.cause = cause;
  }
}

const isNonBlankText = new SchemaAST.Filter(
  (value: string) => value.trim().length > 0
    ? undefined
    : new SchemaIssue.InvalidValue(Option.some(value), { message: "must be non-empty text" }),
);

const isNonNegativeSafeInteger = new SchemaAST.Filter(
  (value: number) => Number.isSafeInteger(value) && value >= 0
    ? undefined
    : new SchemaIssue.InvalidValue(Option.some(value), { message: "must be a non-negative safe integer" }),
);

const isNonNegativeFiniteNumber = new SchemaAST.Filter(
  (value: number) => Number.isFinite(value) && value >= 0
    ? undefined
    : new SchemaIssue.InvalidValue(Option.some(value), { message: "must be a non-negative finite number" }),
);

const text = Schema.String;
const nonEmptyText = Schema.String.pipe(Schema.check(isNonBlankText));
const nullableText = Schema.NullOr(text);
const nullableNonEmptyText = Schema.NullOr(nonEmptyText);
const integer = Schema.Number.pipe(Schema.check(isNonNegativeSafeInteger));
const nullableInteger = Schema.NullOr(integer);
const cost = Schema.Number.pipe(Schema.check(isNonNegativeFiniteNumber));

const sessionReportCaptureWire = Schema.Struct({
  schema: Schema.Literal(sessionReportCaptureSchema),
  capturedAt: integer,
  target: Schema.Struct({
    source: Schema.Struct({
      kind: Schema.Literal("opencode-v2"),
      sourceID: nonEmptyText,
    }),
    address: Schema.Struct({
      kind: Schema.Literal("session"),
      sessionID: nonEmptyText,
    }),
  }),
  report: Schema.Struct({
    title: nullableText,
    slug: nonEmptyText,
    location: Schema.Struct({
      projectID: nonEmptyText,
      workspaceID: nullableNonEmptyText,
      directory: nonEmptyText,
      path: nullableText,
    }),
    lineage: Schema.Struct({
      parentSessionID: nullableNonEmptyText,
      forkSessionID: nullableNonEmptyText,
      forkBoundary: nullableText,
    }),
    run: Schema.Struct({
      version: nonEmptyText,
      agent: nullableText,
      model: nullableText,
    }),
    usage: Schema.Struct({
      cost,
      tokens: Schema.Struct({
        input: integer,
        output: integer,
        reasoning: integer,
        cache: Schema.Struct({
          read: integer,
          write: integer,
        }),
      }),
    }),
    summary: Schema.Struct({
      additions: nullableInteger,
      deletions: nullableInteger,
      files: nullableInteger,
    }),
    shareURL: nullableText,
    lifecycle: Schema.Struct({
      createdAt: integer,
      updatedAt: integer,
      compactingAt: nullableInteger,
      archivedAt: nullableInteger,
      suspendedAt: nullableInteger,
    }),
  }),
  guard: Schema.Struct({
    updatedAt: integer,
  }),
});

type SessionReportCaptureWire = typeof sessionReportCaptureWire.Type;

const decodeWire = Schema.decodeUnknownSync(sessionReportCaptureWire, {
  onExcessProperty: "error",
  errors: "all",
  propertyOrder: "original",
});

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
}

/**
 * Converts one live canonical Session observation into its durable capture.
 *
 * The capture time is the observation time of the read that produced the
 * report, and the initial comparison guard is `lifecycle.updatedAt`.
 */
export function sessionReportCapture(observed: SessionReportObservation): SessionReportCapture {
  const capture: SessionReportCapture = {
    schema: sessionReportCaptureSchema,
    capturedAt: observed.read.observedAt,
    target: observed.target,
    report: observed.value,
    guard: { updatedAt: observed.value.lifecycle.updatedAt },
  };
  deepFreeze(capture);
  return capture;
}

/**
 * Validates an unknown persisted wire value into a trusted, frozen capture.
 *
 * Unknown schema versions, malformed fields, and excess keys such as smuggled
 * read provenance are rejected with `SessionReportCaptureDecodeError`.
 */
export function decodeSessionReportCapture(input: unknown): SessionReportCapture {
  let wire: SessionReportCaptureWire;
  try {
    wire = decodeWire(input);
  } catch (cause) {
    throw new SessionReportCaptureDecodeError(input, cause);
  }
  const capture: SessionReportCapture = {
    schema: sessionReportCaptureSchema,
    capturedAt: wire.capturedAt,
    target: target(
      sourceKey(wire.target.source.sourceID),
      sessionAddress(sessionID(wire.target.address.sessionID)),
    ),
    report: wire.report,
    guard: wire.guard,
  };
  deepFreeze(capture);
  return capture;
}
