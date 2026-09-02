import { Effect } from "effect";
import type { ReadonlyQueryCreator } from "kysely/readonly";
import {
  messageAddress,
  sessionAddress,
  target,
  type MessageAddress,
} from "../domain/address.ts";
import { messageID, sessionID } from "../domain/identifier.ts";
import { observation, type Observation } from "../domain/observation.ts";
import { RowDecodeError } from "../domain/map-address.ts";
import type { LogicalQueryShape, QueryContext, QueryError } from "../query/logical-query.ts";
import type {
  CotailSessionMessageRelations,
  MessageRelation,
  SessionRelation,
} from "../relations/schema.ts";

export interface RecentMessageActivityRequest {
  readonly messageCreatedRange: {
    readonly from?: number;
    readonly to?: number;
  };
  readonly limit: number;
}

export interface MessageActivity {
  readonly messageType: string;
  readonly messageSeq: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly session: {
    readonly title: string | null;
    readonly directory: string;
  };
}

export type MessageActivityObservation = Observation<MessageAddress, MessageActivity>;
export type RecentMessageActivityError = QueryError | RowDecodeError;

type ActivityRow = Pick<
  MessageRelation,
  "sessionID" | "messageID" | "messageType" | "messageSeq" | "createdAt" | "updatedAt"
> & Pick<SessionRelation, "title" | "directory">;

function safeInteger(name: string, value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new RowDecodeError(`${name} must be a safe integer >= ${minimum}`, null);
  }
  return value;
}

function text(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RowDecodeError(`${name} must be non-empty text`, null);
  }
  return value;
}

function nullableText(name: string, value: unknown): string | null {
  if (value === null) return null;
  return text(name, value);
}

function validateRequest(request: RecentMessageActivityRequest): void {
  const range = request.messageCreatedRange;
  if (range.from === undefined && range.to === undefined) {
    throw new TypeError("recent Message activity requires a created-time bound");
  }
  for (const [name, value] of [["from", range.from], ["to", range.to]] as const) {
    if (value !== undefined && !Number.isSafeInteger(value)) {
      throw new TypeError(`Message-created range ${name} must be a safe integer`);
    }
  }
  if (range.from !== undefined && range.to !== undefined && range.from >= range.to) {
    throw new RangeError("Message-created range must increase");
  }
  if (!Number.isSafeInteger(request.limit) || request.limit < 1) {
    throw new RangeError("recent Message activity limit must be a positive safe integer");
  }
}

/**
 * Builds the finite recent-activity statement over Message metadata only.
 * Ordering is newest first with globally unique Message identity as the stable
 * tie-breaker.
 */
export function recentMessageActivityQuery(
  context: QueryContext,
  request: RecentMessageActivityRequest,
) {
  validateRequest(request);
  const db = context.rootWorld({ messageCreatedRange: request.messageCreatedRange }) as
    ReadonlyQueryCreator<CotailSessionMessageRelations>;
  return db.selectFrom("cotail_message")
    .innerJoin("cotail_session", "cotail_session.sessionID", "cotail_message.sessionID")
    .select([
      "cotail_message.sessionID",
      "cotail_message.messageID",
      "cotail_message.messageType",
      "cotail_message.messageSeq",
      "cotail_message.createdAt",
      "cotail_message.updatedAt",
      "cotail_session.title",
      "cotail_session.directory",
    ])
    .orderBy("cotail_message.createdAt", "desc")
    .orderBy("cotail_message.messageID", "desc")
    .limit(request.limit);
}

export function readRecentMessageActivity(
  query: LogicalQueryShape,
  request: RecentMessageActivityRequest,
): Effect.Effect<readonly MessageActivityObservation[], RecentMessageActivityError> {
  validateRequest(request);
  return Effect.scoped(query.openRead.pipe(Effect.flatMap((read) =>
    read.all((context) => recentMessageActivityQuery(context, request)).pipe(
      Effect.flatMap((rows) => Effect.try({
        try: () => (rows as readonly ActivityRow[]).map((row) => {
          const session = sessionAddress(sessionID(text("sessionID", row.sessionID)));
          return observation({
            target: target(read.source, messageAddress(session, messageID(text("messageID", row.messageID)))),
            value: Object.freeze({
              messageType: text("messageType", row.messageType),
              messageSeq: safeInteger("messageSeq", row.messageSeq),
              createdAt: safeInteger("createdAt", row.createdAt),
              updatedAt: safeInteger("updatedAt", row.updatedAt),
              session: Object.freeze({
                title: nullableText("session title", row.title),
                directory: text("session directory", row.directory),
              }),
            }),
            read: read.provenance,
          });
        }),
        catch: (cause) => cause instanceof RowDecodeError
          ? cause
          : new RowDecodeError(cause instanceof Error ? cause.message : String(cause), null),
      })),
    ),
  )));
}
