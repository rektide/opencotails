import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Cause, Effect, Exit } from "effect";
import type { AnyLogicalSelect } from "../src/query/logical-query.ts";
import { all } from "../src/query/logical-query.ts";
import { QueryExecutionError } from "../src/query/errors.ts";
import type { TrustedSourceProfileFacts } from "../src/profile/types.ts";
import {
  SourceOpenError,
  acquireNodeOpenCodeSource,
  type NodeOpenCodeSource,
} from "../src/runtime/node-sqlite.ts";
import { openCodeV2Fixture, trustedSourceProfileFacts } from "./fixtures/opencode-v2.ts";

async function sourceFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-source-"));
  const path = join(directory, "opencode.db");
  const fixture = openCodeV2Fixture();
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

test("opens read-only, registers regexp, rejects writes, and closes exactly once", async () => {
  const fixture = await sourceFixture();
  let retained: NodeOpenCodeSource | undefined;
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "node-test", profile: trustedSourceProfileFacts }).pipe(
        Effect.tap((source) => Effect.sync(() => { retained = source; })),
        Effect.flatMap((source) => Effect.all({
          regex: all(source.query, ({ db }) => db.selectNoFrom((eb) => [
            eb.fn("regexp", [eb.val("^Al"), eb.val("Alpha"), eb.val("")]).as("matched"),
          ])),
          write: all(source.query, () => ({
            compile: () => ({ sql: "insert into kv values ('x', 'x', 0, 0)", parameters: [] }),
          }) as unknown as AnyLogicalSelect).pipe(Effect.flip),
        })),
      ),
    ));

    assert.deepEqual(result.regex.map((row) => ({ ...row })), [{ matched: 1 }]);
    assert(result.write instanceof QueryExecutionError);
    assert.match(result.write.message, /readonly|read-only/);
    assert.equal(retained?.closed, true);
    assert.equal(retained?.closed, true);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("fails missing read-only sources before exposing a query world", async () => {
  const exit = await Effect.runPromise(Effect.scoped(
    Effect.exit(acquireNodeOpenCodeSource({
      path: "/definitely/missing/cotail.db",
      sourceID: "missing",
      profile: trustedSourceProfileFacts,
    })),
  ));
  assert(Exit.isFailure(exit));
  assert(Cause.squash(exit.cause) instanceof SourceOpenError);
});

test("trusts supplied profile facts unchanged without schema or Message type scans", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cotail-trusted-source-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "empty.db");
  new DatabaseSync(path).close();
  const capabilities = Object.freeze({
    "future.lookup": Object.freeze({ status: "indexed" as const, index: "not_present", equality_prefix: ["owner"] }),
  });
  const profile = Object.freeze({
    capabilities,
    supportedMessageVariants: Object.freeze(["future-message-variant"]),
  });
  let contextProfile: TrustedSourceProfileFacts | undefined;

  const result = await Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "trusted", profile }).pipe(
      Effect.flatMap((source) => all(source.query, (context) => {
        contextProfile = context.profile;
        return context.db.selectNoFrom((eb) => eb.val(1).as("value"));
      }).pipe(Effect.map((rows) => ({ source, rows })))),
    ),
  ));

  assert.equal(result.source.profile, profile);
  assert.equal(result.source.capabilities, capabilities);
  assert.equal(contextProfile, profile);
  assert.deepEqual(result.rows.map((row) => ({ ...row })), [{ value: 1 }]);
});
