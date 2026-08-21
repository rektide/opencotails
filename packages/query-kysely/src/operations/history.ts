import type { ReadonlyQueryCreator } from "kysely/readonly";
import { Effect } from "effect";
import { sql } from "kysely";
import type { SessionPredicate } from "../direct/session.ts";
import type { ReadProvenance } from "../domain/observation.ts";
import type { SourceKey } from "../domain/address.ts";
import type { SessionReportObservation } from "../domain/session-report.ts";
import type { CotailRelations } from "../relations/schema.ts";
import {
  decodeSessionReport,
  sessionReportQuery,
  SessionReportDecodeError,
  type SessionReportRow,
} from "./session-report.ts";
import { type LogicalQueryShape, type QueryError } from "../query/logical-query.ts";
import { applySessionPredicate } from "./session-context.ts";

export interface SessionHistoryRequest {
  /** Qualifies which Sessions are listed; never constrains Message counting. */
  readonly predicate?: SessionPredicate;
  /** Inclusive Message-activity cutoff: Messages with createdAt >= since count toward messagesSince. */
  readonly since: number;
  /** Maximum Sessions returned: a positive safe integer. Zero never means unlimited; omit for unlimited. */
  readonly limit?: number;
}

export interface SessionHistoryActivity {
  readonly since: number;
  readonly messagesTotal: number;
  readonly messagesSince: number;
}

export interface SessionHistoryItem {
  readonly session: SessionReportObservation;
  readonly activity: SessionHistoryActivity;
}

export type SessionHistoryError = QueryError | SessionReportDecodeError;

interface HistoryRow extends SessionReportRow {
  readonly messagesTotal: number | null;
  readonly messagesSince: number | null;
}

function validateSessionHistoryRequest(request: SessionHistoryRequest): void {
  if (!Number.isSafeInteger(request.since)) {
    throw new TypeError("history since must be a safe integer");
  }
  if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 1)) {
    throw new RangeError("history limit must be a positive safe integer");
  }
}

/**
 * The sole history selection: the canonical Session report projection joined
 * once to one grouped `cotail_message` aggregate. Both activity counters come
 * from that single aggregate; there are no correlated count subqueries.
 */
export function sessionHistoryQuery(db: ReadonlyQueryCreator<CotailRelations>, request: SessionHistoryRequest) {
  validateSessionHistoryRequest(request);
  let history = applySessionPredicate(sessionReportQuery(db), request.predicate)
    .leftJoin(
      (eb) => eb.selectFrom("cotail_message")
        .select((count) => [
          "cotail_message.sessionID",
          count.fn.countAll<number>().as("messagesTotal"),
          sql<number>`sum(case when ${count.ref("cotail_message.createdAt")} >= ${request.since} then 1 else 0 end)`
            .as("messagesSince"),
        ])
        .groupBy("cotail_message.sessionID")
        .as("session_activity"),
      (join) => join.onRef("session_activity.sessionID", "=", "cotail_session.sessionID"),
    )
    .select((eb) => [
      sql<number>`coalesce(${eb.ref("session_activity.messagesTotal")}, 0)`.as("messagesTotal"),
      sql<number>`coalesce(${eb.ref("session_activity.messagesSince")}, 0)`.as("messagesSince"),
    ])
    .orderBy("cotail_session.updatedAt", "desc")
    .orderBy("cotail_session.sessionID", "desc");
  if (request.limit !== undefined) history = history.limit(request.limit);
  return history;
}

function countOf(row: HistoryRow, field: "messagesTotal" | "messagesSince"): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`history ${field} must be a non-negative safe integer`);
  }
  return value;
}

function decodeHistoryRows(
  rows: readonly HistoryRow[],
  since: number,
  source: SourceKey,
  read: ReadProvenance,
): Effect.Effect<readonly SessionHistoryItem[], SessionHistoryError> {
  try {
    return Effect.succeed(rows.map((row) => ({
      session: decodeSessionReport(row, source, read),
      activity: {
        since,
        messagesTotal: countOf(row, "messagesTotal"),
        messagesSince: countOf(row, "messagesSince"),
      },
    })));
  } catch (cause) {
    return cause instanceof SessionReportDecodeError ? Effect.fail(cause) : Effect.die(cause);
  }
}

export function readSessionHistory(
  query: LogicalQueryShape,
  request: SessionHistoryRequest,
): Effect.Effect<readonly SessionHistoryItem[], SessionHistoryError> {
  validateSessionHistoryRequest(request);
  return Effect.scoped(query.openRead.pipe(Effect.flatMap((read) =>
    read.all(({ db }) => sessionHistoryQuery(db, request)).pipe(
      // The raw count selects type as `number`, but a Session without Messages
      // yields null from the outer join, so decode through the nullable row.
      Effect.flatMap((rows) => decodeHistoryRows(rows as readonly HistoryRow[], request.since, read.source, read.provenance)),
    ),
  )));
}
