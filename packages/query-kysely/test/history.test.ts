import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { sessionUpdatedRange } from "../src/direct/session.ts";
import { readSessionHistory } from "../src/operations/history.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { openCodeV2Fixture, validMessageData } from "./fixtures/opencode-v2.ts";

async function historyFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-history-"));
  const path = join(directory, "source.db");
  const fixture = openCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_a', 'p1', 'a', '/work/a', 'A', '2', 1, 10),
      ('ses_b', 'p1', 'b', '/work/b', 'B', '2', 2, 20),
      ('ses_c', 'p2', 'c', '/other/c', 'C', '2', 3, 20);
    create table session (id text);
    create table message (id text, session_id text, time_created integer);
    insert into session values ('ses_legacy');
    insert into message values ('legacy_b', 'ses_b', 100), ('legacy_only', 'ses_legacy', 100);
  `);
  const insert = fixture.database.prepare("insert into session_message values (?, ?, ?, ?, ?, ?, ?)");
  for (const [id, session, type, seq, time] of [
    ["msg_user", "ses_b", "user", 0, 1], ["msg_assistant", "ses_b", "assistant", 1, 2],
    ["msg_synthetic", "ses_b", "synthetic", 2, 3], ["msg_system", "ses_b", "system", 3, 4],
    ["msg_skill", "ses_b", "skill", 4, 5], ["msg_shell", "ses_b", "shell", 5, 6],
    ["msg_compaction", "ses_b", "compaction", 6, 7], ["msg_c", "ses_c", "user", 0, 8],
  ] as const) insert.run(id, session, type, seq, time, time, JSON.stringify(validMessageData(type, id, time)));
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

async function history(path: string, request: Parameters<typeof readSessionHistory>[1]) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture" }).pipe(
      Effect.flatMap(({ query }) => readSessionHistory(query, request)),
    ),
  ));
}

test("counts every V2 Message variant and keeps selection and count cutoffs distinct", async () => {
  const fixture = await historyFixture();
  try {
    const rows = await history(fixture.path, {
      predicate: sessionUpdatedRange({ from: 15 }),
      countSince: 5,
      limit: 0,
    });
    assert.deepEqual(rows.map((row) => [row.id, row.messagesTotal, row.messagesRecent]), [
      ["ses_c", 1, 1],
      ["ses_b", 7, 3],
    ]);
    assert.equal(rows.some((row) => row.id === "ses_legacy"), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("orders ties deterministically, supports zero-message rows, and treats zero as unlimited", async () => {
  const fixture = await historyFixture();
  try {
    const [all, one] = await Promise.all([
      history(fixture.path, { countSince: 0, limit: 0 }),
      history(fixture.path, { countSince: 0, limit: 1 }),
    ]);
    assert.deepEqual(all.map((row) => row.id), ["ses_c", "ses_b", "ses_a"]);
    assert.deepEqual([all[2]!.messagesTotal, all[2]!.messagesRecent], [0, 0]);
    assert.deepEqual(one.map((row) => row.id), ["ses_c"]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
