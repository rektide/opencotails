import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Cause, Effect, Exit } from "effect";
import type { AnyLogicalSelect } from "../src/query/logical-query.ts";
import { QueryExecutionError } from "../src/query/errors.ts";
import {
  SourceOpenError,
  acquireNodeOpenCodeSource,
  type NodeOpenCodeSource,
} from "../src/runtime/node-sqlite.ts";
import { openCodeV2Fixture } from "./fixtures/opencode-v2.ts";

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
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "node-test" }).pipe(
        Effect.tap((source) => Effect.sync(() => { retained = source; })),
        Effect.flatMap((source) => Effect.all({
          regex: source.query.run(({ db }) => db.selectNoFrom((eb) => [
            eb.fn("regexp", [eb.val("^Al"), eb.val("Alpha"), eb.val("")]).as("matched"),
          ])),
          write: source.query.run(() => ({
            compile: () => ({ sql: "insert into kv values ('x', 'x', 0, 0)", parameters: [] }),
          }) as unknown as AnyLogicalSelect).pipe(Effect.flip),
        })),
      ),
    ));

    assert.deepEqual(result.regex.map((row) => ({ ...row })), [{ matched: 1 }]);
    assert(result.write instanceof QueryExecutionError);
    assert.match(result.write.message, /read-only adapter/);
    assert.equal(retained?.closed, true);
    assert.equal(retained?.closed, true);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("fails missing read-only sources before exposing a query world", async () => {
  const exit = await Effect.runPromise(Effect.scoped(
    Effect.exit(acquireNodeOpenCodeSource({ path: "/definitely/missing/cotail.db", sourceID: "missing" })),
  ));
  assert(Exit.isFailure(exit));
  assert(Cause.squash(exit.cause) instanceof SourceOpenError);
});
