import type { ExpressionBuilder } from "kysely";
import type { SessionPredicate, SessionPredicateContext } from "../direct/session.ts";
import type { CotailRelations, CotailSessionRelations } from "../relations/schema.ts";

export function sessionContext<DB extends CotailSessionRelations>(
  eb: ExpressionBuilder<DB, "cotail_session">,
): SessionPredicateContext<DB, "cotail_session"> {
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

export function applySessionPredicate<Q extends {
  where: (callback: (eb: ExpressionBuilder<CotailRelations, "cotail_session">) => ReturnType<SessionPredicate>) => Q;
}>(query: Q, predicate: SessionPredicate | undefined): Q {
  return predicate === undefined ? query : query.where((eb) => predicate(sessionContext(eb)));
}
