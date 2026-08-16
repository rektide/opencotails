import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { sessionDirectoryExact, sessionIDs } from "../src/direct/session.ts";
import { resolveSession } from "../src/operations/resolve.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { openCodeV2Fixture } from "./fixtures/opencode-v2.ts";

async function resolveFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-resolve-"));
  const path = join(directory, "source.db");
  const fixture = openCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_a', 'p1', null, 'a', '/work', 'A', '2.0', 1, 10),
      ('ses_b', 'p1', 'ses_a', 'b', '/work', 'B', '2.1', 2, 20),
      ('ses_c', 'p2', null, 'c', '/other', 'C', '2.2', 3, 20);
    create table session (id text);
    insert into session values ('ses_legacy');
  `);
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

async function resolve(path: string, request: Parameters<typeof resolveSession>[1]) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture" }).pipe(
      Effect.flatMap(({ query }) => resolveSession(query, request)),
    ),
  ));
}

test("latest uses a deterministic Session ID tie-breaker and returns full CLI metadata", async () => {
  const fixture = await resolveFixture();
  try {
    assert.deepEqual(await resolve(fixture.path, { mode: "latest" }), {
      id: "ses_c", title: "C", directory: "/other", slug: "c", projectId: "p2",
      parentId: null, version: "2.2", timeCreated: 3, timeUpdated: 20,
    });
    assert.equal(await resolve(fixture.path, { predicate: sessionIDs(["ses_legacy"]), mode: "latest" }), undefined);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("only returns exactly one match and rejects zero or multiple matches", async () => {
  const fixture = await resolveFixture();
  try {
    assert.equal((await resolve(fixture.path, { predicate: sessionIDs(["ses_b"]), mode: "only" }))?.parentId, "ses_a");
    assert.equal(await resolve(fixture.path, { predicate: sessionDirectoryExact("/work"), mode: "only" }), undefined);
    assert.equal(await resolve(fixture.path, { predicate: sessionIDs([]), mode: "only" }), undefined);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
