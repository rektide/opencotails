import type { SessionPredicate } from "../direct/session.ts";
import type { HistoryEntry } from "../domain/results.ts";
import { all, type LogicalQueryShape, type QueryError } from "../query/logical-query.ts";
import { applySessionPredicate } from "./session-context.ts";
import { Effect } from "effect";
import { sql } from "kysely";

export interface SessionHistoryRequest {
  readonly predicate?: SessionPredicate;
  readonly countSince: number;
  /** Undefined and zero both mean unlimited. */
  readonly limit?: number;
}

export function readSessionHistory(
  query: LogicalQueryShape,
  request: SessionHistoryRequest,
): Effect.Effect<readonly HistoryEntry[], QueryError> {
  if (!Number.isFinite(request.countSince)) throw new TypeError("countSince must be finite");
  if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 0)) {
    throw new RangeError("history limit must be a non-negative safe integer");
  }

  return all(query, ({ db }) => {
    let history = applySessionPredicate(db.selectFrom("cotail_session"), request.predicate)
      .select([
        "cotail_session.sessionID as id",
        "cotail_session.title",
        "cotail_session.directory",
        "cotail_session.slug",
        "cotail_session.projectID as projectId",
        "cotail_session.parentID as parentId",
        "cotail_session.version",
        "cotail_session.createdAt as timeCreated",
        "cotail_session.updatedAt as timeUpdated",
        (eb) => sql<number>`coalesce(${eb.selectFrom("cotail_message")
          .whereRef("cotail_message.sessionID", "=", "cotail_session.sessionID")
          .select((count) => count.fn.countAll<number>().as("count"))}, 0)`.as("messagesTotal"),
        (eb) => sql<number>`coalesce(${eb.selectFrom("cotail_message")
          .whereRef("cotail_message.sessionID", "=", "cotail_session.sessionID")
          .where("cotail_message.createdAt", ">=", request.countSince)
          .select((count) => count.fn.countAll<number>().as("count"))}, 0)`.as("messagesRecent"),
      ])
      .orderBy("cotail_session.updatedAt", "desc")
      .orderBy("cotail_session.sessionID", "desc");
    if (request.limit !== undefined && request.limit !== 0) history = history.limit(request.limit);
    return history;
  }).pipe(Effect.map((rows) => rows.map((row) => ({ ...row }))));
}
