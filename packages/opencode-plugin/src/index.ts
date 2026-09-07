import { Plugin } from "@opencode-ai/plugin/effect";
import { Tool } from "@opencode-ai/schema/tool";
import { Effect } from "effect";
import { z } from "zod";
import { sessionGet } from "opencoattails/tools/session-get";
import { SessionGetInput, SessionGetSuccess } from "opencoattails/tools/session-get/contract";
import { CotailRead } from "./rpc.ts";

const Options = z.strictObject({
  profilePath: z.string().min(1).optional(),
  databasePath: z.string().min(1).optional(),
  busyTimeoutMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  maxOutputBytes: z.number().int().min(4096).max(1_048_576).optional(),
});

export default Plugin.define({
  id: "cotail-read",
  effect: ctx => Effect.gen(function* () {
    const source = Options.parse(ctx.options);
    const lifetime = new AbortController();
    yield* Effect.addFinalizer(() => Effect.sync(() => lifetime.abort()));
    // Only the Promise and plain result cross the independent Effect runtimes.
    const read = (input: unknown) => Effect.promise(signal => sessionGet(source, input, {
      signal: AbortSignal.any([signal, lifetime.signal]),
    }));

    yield* ctx.rpc.register(CotailRead, {
      sessionGet: (input, context) => read(input).pipe(Effect.flatMap(result => result.ok
        ? Effect.succeed(result)
        : Effect.fail(context.error("read_failed", result.error.message, result.error)))),
    }).pipe(Effect.orDie);

    yield* ctx.tool.transform(editor => editor.add({
      name: "cotail_session_get",
      description: "Read one exact Session from Cotail's configured source, including children. The source is selection-scoped, not proven to be this OpenCode server or a durable catalog identity. No writes or transcript-body reads.",
      options: { codemode: false },
      input: SessionGetInput,
      output: SessionGetSuccess,
      execute: input => read(input).pipe(Effect.flatMap(result => result.ok
        ? Effect.succeed({ output: result, content: JSON.stringify(result) })
        : Effect.fail(new Tool.Error({ message: result.error.message, metadata: { cotail: result.error } })))),
    })).pipe(Effect.orDie);
  }),
});
