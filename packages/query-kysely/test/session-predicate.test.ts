import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import {
  sessionDirectoryContains,
  sessionDirectoryExact,
  sessionPredicate,
  sessionProjectIDs,
  sessionUpdatedRange,
} from "../src/direct/session.ts";
import { resolveSession } from "../src/operations/resolve.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { openCodeV2Fixture } from "./fixtures/opencode-v2.ts";

async function predicateFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-predicate-"));
  const path = join(directory, "source.db");
  const fixture = openCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_a', 'p1', 'a', '/work/app', 'A', '2', 1, 10),
      ('ses_b', 'p1', 'b', '/work/app-child', 'B', '2', 2, 20),
      ('ses_c', 'p2', 'c', '/other/app', 'C', '2', 3, 30);
  `);
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

async function select(path: string, predicate: Parameters<typeof resolveSession>[1]["predicate"]) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture" }).pipe(
      Effect.flatMap(({ query }) => resolveSession(query, { predicate, mode: "latest" })),
    ),
  ));
}

test("contextual predicates compose with ordinary Kysely boolean expressions", async () => {
  const fixture = await predicateFixture();
  try {
    const project = sessionProjectIDs(["p1"]);
    const range = sessionUpdatedRange({ from: 10, to: 20 });
    const composed = sessionPredicate((context) => context.eb.and([project(context), range(context)]));
    assert.equal((await select(fixture.path, composed))?.id, "ses_a");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("directory helpers distinguish exact and contains matching", async () => {
  const fixture = await predicateFixture();
  try {
    assert.equal((await select(fixture.path, sessionDirectoryExact("/work/app")))?.id, "ses_a");
    assert.equal((await select(fixture.path, sessionDirectoryContains("/work/app")))?.id, "ses_b");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
