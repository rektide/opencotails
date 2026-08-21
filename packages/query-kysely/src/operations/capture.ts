import { Effect } from "effect";
import {
  sessionReportCapture,
  type SessionReportCapture,
} from "../domain/session-report-capture.ts";
import type { SessionID } from "../domain/identifier.ts";
import type { LogicalQueryShape } from "../query/logical-query.ts";
import { getSession, SessionNotFoundError, type SessionLookupError } from "./resolve.ts";

/**
 * Produces the durable, versioned capture of one Session.
 *
 * The capture is read and decoded by the canonical exact-ID lookup under one
 * `LogicalRead`, records the read's observation time as `capturedAt`, and
 * stores `lifecycle.updatedAt` as the initial comparison guard. The result is
 * a typed value; persisting it belongs to callers outside this package.
 */
export function captureSessionReport(
  query: LogicalQueryShape,
  id: SessionID,
): Effect.Effect<SessionReportCapture, SessionLookupError | SessionNotFoundError> {
  return getSession(query, id).pipe(Effect.map(sessionReportCapture));
}
