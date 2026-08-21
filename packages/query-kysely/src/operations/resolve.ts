import { Effect } from "effect";
import type { SessionPredicate } from "../direct/session.ts";
import type { SessionID } from "../domain/identifier.ts";
import type { SessionCursor } from "../domain/results.ts";
import type { SessionReportObservation } from "../domain/session-report.ts";
import type { LogicalQueryShape, QueryError } from "../query/logical-query.ts";
import { applySessionPredicate } from "./session-context.ts";
import {
  decodeSessionReport,
  SessionReportDecodeError,
  sessionReportQuery,
  type SessionReportRow,
} from "./session-report.ts";

export class SessionNotFoundError extends Error {
  public readonly sessionID: SessionID;

  public constructor(sessionID: SessionID) {
    super(`Session not found: ${sessionID}`);
    this.name = "SessionNotFoundError";
    this.sessionID = sessionID;
  }
}

export interface ListSessionsRequest {
  readonly predicate?: SessionPredicate;
  readonly order: "updated-asc" | "updated-desc";
  readonly page: {
    readonly first: number;
    readonly after?: SessionCursor;
  };
}

export interface SessionPage {
  readonly sessions: readonly SessionReportObservation[];
  readonly next?: SessionCursor;
}

export type SessionLookupError = QueryError | SessionReportDecodeError;

function decodeRows(
  rows: readonly SessionReportRow[],
  read: Parameters<typeof decodeSessionReport>[2],
  source: Parameters<typeof decodeSessionReport>[1],
): Effect.Effect<readonly SessionReportObservation[], SessionReportDecodeError> {
  try {
    return Effect.succeed(rows.map((row) => decodeSessionReport(row, source, read)));
  } catch (cause) {
    return cause instanceof SessionReportDecodeError ? Effect.fail(cause) : Effect.die(cause);
  }
}

export function getSession(
  query: LogicalQueryShape,
  id: SessionID,
): Effect.Effect<SessionReportObservation, SessionLookupError | SessionNotFoundError> {
  return Effect.scoped(query.openRead.pipe(Effect.flatMap((read) => read.all(({ db }) => sessionReportQuery(db)
    .where("cotail_session.sessionID", "=", id)
    .limit(1)).pipe(
    Effect.flatMap((rows) => Effect.gen(function* () {
      if (rows[0] === undefined) return yield* Effect.fail(new SessionNotFoundError(id));
      const decoded = yield* decodeRows(rows, read.provenance, read.source);
      return decoded[0]!;
    })),
  ))));
}

export function findLatestSession(
  query: LogicalQueryShape,
  predicate?: SessionPredicate,
): Effect.Effect<SessionReportObservation | undefined, SessionLookupError> {
  return Effect.scoped(query.openRead.pipe(Effect.flatMap((read) => read.all(({ db }) =>
    applySessionPredicate(sessionReportQuery(db), predicate)
      .orderBy("cotail_session.updatedAt", "desc")
      .orderBy("cotail_session.sessionID", "desc")
      .limit(1)).pipe(
    Effect.flatMap((rows) => decodeRows(rows, read.provenance, read.source)),
    Effect.map((rows) => rows[0]),
  ))));
}

function validateListRequest(request: ListSessionsRequest): void {
  if (!Number.isSafeInteger(request.page.first) || request.page.first <= 0) {
    throw new RangeError("Session page size must be a positive safe integer");
  }
  const cursor = request.page.after;
  if (cursor !== undefined && (!Number.isSafeInteger(cursor.updatedAt) || cursor.updatedAt < 0
    || cursor.sessionID.trim().length === 0)) {
    throw new RangeError("invalid Session cursor");
  }
}

export function listSessions(
  query: LogicalQueryShape,
  request: ListSessionsRequest,
): Effect.Effect<SessionPage, SessionLookupError> {
  validateListRequest(request);
  const direction = request.order === "updated-desc" ? "desc" : "asc";
  return Effect.scoped(query.openRead.pipe(Effect.flatMap((read) => read.all(({ db }) => {
    let sessions = applySessionPredicate(sessionReportQuery(db), request.predicate);
    const cursor = request.page.after;
    if (cursor !== undefined) {
      sessions = sessions.where((eb) => eb.or([
        eb("cotail_session.updatedAt", direction === "desc" ? "<" : ">", cursor.updatedAt),
        eb.and([
          eb("cotail_session.updatedAt", "=", cursor.updatedAt),
          eb("cotail_session.sessionID", direction === "desc" ? "<" : ">", cursor.sessionID),
        ]),
      ]));
    }
    return sessions
      .orderBy("cotail_session.updatedAt", direction)
      .orderBy("cotail_session.sessionID", direction)
      .limit(request.page.first === Number.MAX_SAFE_INTEGER ? request.page.first : request.page.first + 1);
  }).pipe(
    Effect.flatMap((rows) => decodeRows(rows, read.provenance, read.source)),
    Effect.map((decoded) => {
      const sessions = decoded.slice(0, request.page.first);
      const last = sessions.at(-1);
      return {
        sessions,
        ...(decoded.length > request.page.first && last !== undefined
          ? { next: { updatedAt: last.value.lifecycle.updatedAt, sessionID: last.target.address.sessionID } }
          : {}),
      };
    }),
  ))));
}
