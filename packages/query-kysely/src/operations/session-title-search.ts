import { Effect } from "effect";
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";
import type { ReadonlyQueryCreator } from "kysely/readonly";
import { literal, regex, type LiteralOptions, type RegexOptions } from "../direct/match.ts";
import type { SessionPredicate } from "../direct/session.ts";
import type { SessionReportObservation } from "../domain/session-report.ts";
import type { LogicalQueryShape, QueryContext, QueryError } from "../query/logical-query.ts";
import type {
  CotailSessionMessageRelations,
  CotailSessionRelations,
} from "../relations/schema.ts";
import {
  decodeSessionReport,
  sessionReportColumns,
  SessionReportDecodeError,
  type SessionReportRow,
} from "./session-report.ts";

export type SessionTitleTerm =
  | {
    readonly kind: "literal";
    readonly value: string;
    readonly case?: LiteralOptions["case"];
  }
  | {
    readonly kind: "regex";
    readonly source: string;
    readonly flags?: RegexOptions["flags"];
  };

export interface SessionTitleSearchRequest {
  /** Every term must independently match the Session's single title value. */
  readonly terms: readonly SessionTitleTerm[];
  readonly sessionPredicate?: SessionPredicate;
  /** Requires qualifying Sessions to have Message activity in this half-open range. */
  readonly messageCreatedRange?: {
    readonly from?: number;
    readonly to?: number;
  };
  readonly limit: number;
}

export type SessionTitleSearchError = QueryError | SessionReportDecodeError;

function validateTerm(term: SessionTitleTerm, index: number): void {
  if (term === null || typeof term !== "object") {
    throw new TypeError(`title term ${index} must be an object`);
  }
  if (term.kind === "literal") {
    if (typeof term.value !== "string") throw new TypeError(`title term ${index} value must be text`);
    if (term.case !== undefined && term.case !== "sensitive" && term.case !== "insensitive") {
      throw new TypeError(`title term ${index} case must be sensitive or insensitive`);
    }
    return;
  }
  if (term.kind === "regex") {
    if (typeof term.source !== "string") throw new TypeError(`title term ${index} source must be text`);
    if (term.flags !== undefined && term.flags !== "" && term.flags !== "i") {
      throw new TypeError(`title term ${index} flags must be empty or i`);
    }
    return;
  }
  throw new TypeError(`title term ${index} has an unknown kind`);
}

function validateRequest(request: SessionTitleSearchRequest): void {
  if (!Array.isArray(request.terms) || request.terms.length === 0) {
    throw new TypeError("title search requires at least one term");
  }
  request.terms.forEach(validateTerm);
  if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
    throw new RangeError("title search limit must be a positive safe integer");
  }
  const range = request.messageCreatedRange;
  if (range === undefined) return;
  if (range.from === undefined && range.to === undefined) {
    throw new TypeError("Message-created range requires a bound");
  }
  for (const [name, value] of [["from", range.from], ["to", range.to]] as const) {
    if (value !== undefined && !Number.isSafeInteger(value)) {
      throw new TypeError(`Message-created range ${name} must be a safe integer`);
    }
  }
  if (range.from !== undefined && range.to !== undefined && range.from >= range.to) {
    throw new RangeError("Message-created range must increase");
  }
}

function matchTitle(title: Expression<string>, term: SessionTitleTerm): Expression<SqlBool> {
  return term.kind === "literal"
    ? literal(title, term.value, { case: term.case })
    : regex(title, term.source, { flags: term.flags });
}

function sessionPredicateContext<DB extends CotailSessionRelations>(
  eb: ExpressionBuilder<DB, "cotail_session">,
) {
  return {
    eb,
    session: {
      sessionID: eb.ref("cotail_session.sessionID"),
      projectID: eb.ref("cotail_session.projectID"),
      directory: eb.ref("cotail_session.directory"),
      updatedAt: eb.ref("cotail_session.updatedAt"),
    },
  };
}

function buildSessionTitleSearchQuery(
  db: ReadonlyQueryCreator<CotailSessionMessageRelations>,
  request: SessionTitleSearchRequest,
  activity?: (
    eb: ExpressionBuilder<CotailSessionMessageRelations, "cotail_session">,
  ) => Expression<SqlBool>,
) {
  return db
    .with("candidate_sessions", (qb) => {
      let candidates = qb.selectFrom("cotail_session").select(sessionReportColumns);
      if (request.sessionPredicate !== undefined) {
        candidates = candidates.where((eb) => request.sessionPredicate!(sessionPredicateContext(eb)));
      }
      if (activity !== undefined) candidates = candidates.where(activity);
      return candidates;
    })
    .with("title_qualified_sessions", (qb) => {
      let qualified = qb.selectFrom("candidate_sessions").selectAll()
        .where(sql<SqlBool>`typeof(${sql.ref("candidate_sessions.title")}) = 'text'`);
      const title = sql<string>`${sql.ref("candidate_sessions.title")}`;
      for (const term of request.terms) {
        qualified = qualified.where(matchTitle(title, term));
      }
      return qualified;
    })
    .selectFrom("title_qualified_sessions")
    .selectAll()
    .orderBy("updatedAt", "desc")
    .orderBy("sessionID", "desc")
    .limit(request.limit);
}

/**
 * Builds title qualification directly over Session roots. Unlike document
 * search, this statement never seeds payload validation or JSON relations.
 */
export function sessionTitleSearchQuery(
  context: QueryContext,
  request: SessionTitleSearchRequest,
) {
  validateRequest(request);
  if (request.messageCreatedRange === undefined) {
    // The helper's common query body only references cotail_message when an
    // activity callback is supplied; the root-only world intentionally omits it.
    return buildSessionTitleSearchQuery(
      context.rootWorld() as unknown as ReadonlyQueryCreator<CotailSessionMessageRelations>,
      request,
    );
  }
  const db = context.rootWorld({ messageCreatedRange: request.messageCreatedRange });
  return buildSessionTitleSearchQuery(db, request, (eb: ExpressionBuilder<
    CotailSessionMessageRelations,
    "cotail_session"
  >) => eb.exists(eb.selectFrom("cotail_message")
    .select("cotail_message.messageID")
    .whereRef("cotail_message.sessionID", "=", "cotail_session.sessionID")));
}

export function searchSessionTitles(
  query: LogicalQueryShape,
  request: SessionTitleSearchRequest,
): Effect.Effect<readonly SessionReportObservation[], SessionTitleSearchError> {
  validateRequest(request);
  return Effect.scoped(query.openRead.pipe(Effect.flatMap((read) => read.all((context) =>
    sessionTitleSearchQuery(context, request)).pipe(
    Effect.flatMap((rows) => {
      try {
        return Effect.succeed((rows as readonly SessionReportRow[]).map((row) =>
          decodeSessionReport(row, read.source, read.provenance)));
      } catch (cause) {
        return cause instanceof SessionReportDecodeError ? Effect.fail(cause) : Effect.die(cause);
      }
    }),
  ))));
}
