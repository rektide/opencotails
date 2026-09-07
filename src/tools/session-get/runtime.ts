import { Effect } from "effect";
import { acquireNodeOpenCodeSource, getSession, sessionID, SessionNotFoundError, SessionReportDecodeError } from "@opencoattails/query-kysely";
import { resolveRuntimeSource } from "../../profile/runtime.ts";
import { sessionGetError } from "./contract.ts";
import type { SessionGetInput, SessionGetResult, SessionGetSuccess } from "./contract.ts";
import type { SessionGetOptions, SessionGetSource } from "./index.ts";

export async function readSession(
  config: SessionGetSource,
  input: SessionGetInput,
  maxOutputBytes: number,
  options: SessionGetOptions,
): Promise<SessionGetResult> {
  try {
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const selected = yield* Effect.tryPromise({
        try: () => resolveRuntimeSource({ profilePath: config.profilePath, databasePath: config.databasePath }),
        catch: cause => sessionGetError("source-profile", cause instanceof Error ? cause.message : "Unable to read source profile."),
      });
      const source = yield* acquireNodeOpenCodeSource({ ...selected, busyTimeoutMs: config.busyTimeoutMs }).pipe(
        Effect.mapError(error => sessionGetError("source-unavailable", error.message)),
      );
      const observation = yield* getSession(source.query, sessionID(input.sessionID)).pipe(Effect.mapError(error =>
        sessionGetError(error instanceof SessionNotFoundError ? "session-not-found"
          : error instanceof SessionReportDecodeError ? "invalid-report" : "query-failed", error.message)));
      const value: SessionGetSuccess = {
        schema: "cotail.session-get.result/v1", ok: true, identityStatus: "selection-scoped", observation,
      };
      if (Buffer.byteLength(JSON.stringify(value)) > maxOutputBytes) {
        return yield* Effect.fail(sessionGetError("output-too-large", `Session report exceeds the configured ${maxOutputBytes}-byte output budget.`));
      }
      return value;
    })).pipe(Effect.match({
      onSuccess: value => value,
      onFailure: error => ({ ok: false as const, error }),
    })), { signal: options.signal });
    if (options.signal?.aborted) return { ok: false, error: sessionGetError("cancelled", "Session read cancelled.") };
    return result;
  } catch (cause) {
    if (options.signal?.aborted) return { ok: false, error: sessionGetError("cancelled", "Session read cancelled.") };
    throw cause;
  }
}
