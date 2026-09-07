import { z } from "zod";

// Portable wire contracts: no query runtime, SQLite, or Effect imports.
const text = z.string();
const nullableText = text.nullable();
const number = z.number();
const nullableNumber = number.nullable();
const session = z.strictObject({ kind: z.literal("session"), sessionID: text });

export const SessionGetInput = z.strictObject({
  schema: z.literal("cotail.session-get.input/v1"),
  sessionID: z.string().min(1).max(256).refine(value => value.trim().length > 0, "Session ID must not be blank"),
});
export type SessionGetInput = z.infer<typeof SessionGetInput>;

export const SessionGetSuccess = z.strictObject({
  schema: z.literal("cotail.session-get.result/v1"),
  ok: z.literal(true),
  identityStatus: z.literal("selection-scoped"),
  observation: z.strictObject({
    target: z.strictObject({
      source: z.strictObject({ kind: z.literal("opencode-v2"), sourceID: text }),
      address: session,
    }),
    value: z.strictObject({
      title: nullableText,
      slug: text,
      location: z.strictObject({ projectID: text, workspaceID: nullableText, directory: text, path: nullableText }),
      lineage: z.strictObject({ parentSessionID: nullableText, forkSessionID: nullableText, forkBoundary: nullableText }),
      run: z.strictObject({ version: text, agent: nullableText, model: nullableText }),
      usage: z.strictObject({
        cost: number,
        tokens: z.strictObject({
          input: number, output: number, reasoning: number,
          cache: z.strictObject({ read: number, write: number }),
        }),
      }),
      summary: z.strictObject({ additions: nullableNumber, deletions: nullableNumber, files: nullableNumber }),
      shareURL: nullableText,
      lifecycle: z.strictObject({
        createdAt: number, updatedAt: number, compactingAt: nullableNumber,
        archivedAt: nullableNumber, suspendedAt: nullableNumber,
      }),
    }),
    read: z.strictObject({ readScopeID: text, observedAt: number }),
  }),
});
export type SessionGetSuccess = z.infer<typeof SessionGetSuccess>;

export const SessionGetError = z.strictObject({
  schema: z.literal("cotail.session-get.error/v1"),
  code: z.enum([
    "invalid-input", "invalid-configuration", "source-profile", "source-unavailable",
    "session-not-found", "query-failed", "invalid-report", "output-too-large", "cancelled",
  ]),
  message: z.string().max(256),
});
export type SessionGetError = z.infer<typeof SessionGetError>;
export type SessionGetResult = SessionGetSuccess | { readonly ok: false; readonly error: SessionGetError };

export function sessionGetError(code: SessionGetError["code"], message: string): SessionGetError {
  return { schema: "cotail.session-get.error/v1", code, message: message.slice(0, 256) };
}
