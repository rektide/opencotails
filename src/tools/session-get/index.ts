import { SessionGetInput, sessionGetError } from "./contract.ts";
import type { SessionGetResult } from "./contract.ts";

/** Operator configuration, deliberately absent from the callable input schema. */
export interface SessionGetSource {
  readonly profilePath?: string;
  readonly databasePath?: string;
  readonly busyTimeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface SessionGetOptions {
  readonly signal?: AbortSignal;
}

/** One finite read. Expected failures are plain data; private Effect values never escape. */
export async function sessionGet(
  source: SessionGetSource,
  input: unknown,
  options: SessionGetOptions = {},
): Promise<SessionGetResult> {
  const decoded = SessionGetInput.safeParse(input);
  if (!decoded.success) return { ok: false, error: sessionGetError("invalid-input", "Expected only schema cotail.session-get.input/v1 and a nonblank Session ID (at most 256 characters).") };
  if (options.signal?.aborted) return { ok: false, error: sessionGetError("cancelled", "Session read cancelled.") };
  const maxOutputBytes = source.maxOutputBytes ?? 65_536;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 4096 || maxOutputBytes > 1_048_576 ||
    (source.busyTimeoutMs !== undefined && (!Number.isSafeInteger(source.busyTimeoutMs) || source.busyTimeoutMs < 0))) {
    return { ok: false, error: sessionGetError("invalid-configuration", "Output budget must be 4096–1048576 bytes; busy timeout must be a nonnegative safe integer.") };
  }
  const { readSession } = await import("./runtime.ts");
  return readSession(source, decoded.data, maxOutputBytes, options);
}
