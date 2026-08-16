import { Effect } from "effect";
import type { SessionPredicate } from "../direct/session.ts";
import type { SessionDetails } from "../domain/results.ts";
import type { LogicalQueryShape, QueryError } from "../query/logical-query.ts";
import { applySessionPredicate } from "./session-context.ts";

export interface ResolveSessionRequest {
  readonly predicate?: SessionPredicate;
  readonly mode: "latest" | "only";
}

export function resolveSession(
  query: LogicalQueryShape,
  request: ResolveSessionRequest,
): Effect.Effect<SessionDetails | undefined, QueryError> {
  return query.run(({ db }) => applySessionPredicate(db.selectFrom("cotail_session"), request.predicate)
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
    ])
    .orderBy("cotail_session.updatedAt", "desc")
    .orderBy("cotail_session.sessionID", "desc")
    .limit(request.mode === "only" ? 2 : 1)).pipe(
      Effect.map((rows) => {
        if (request.mode === "only" && rows.length !== 1) return undefined;
        return rows[0] === undefined ? undefined : { ...rows[0] };
      }),
    );
}
