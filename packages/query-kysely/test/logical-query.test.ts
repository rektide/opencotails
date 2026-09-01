import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { all } from "../src/query/logical-query.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { indexedOpenCodeV2Fixture, trustedSourceProfileFacts, validMessageData } from "./fixtures/opencode-v2/index.ts";

async function queryFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-query-"));
  const path = join(directory, "opencode.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.database.exec(`
    insert into session_v2 (
      id, project_id, slug, directory, title, version, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
      tokens_cache_write, time_created, time_updated
    ) values
      ('ses_a', 'prj_a', 'a', '/a', 'Alpha', '2', 0, 0, 0, 0, 0, 0, 1, 10),
      ('ses_b', 'prj_b', 'b', '/b', 'Beta', '2', 0, 0, 0, 0, 0, 0, 2, 20);
    create table session (id text);
    create table message (id text, session_id text, seq integer);
    create table part (id text);
    insert into session values ('ses_v1');
    insert into message values ('msg_v1', 'ses_v1', 3);
    insert into part values ('part_v1');
  `);
  const insert = fixture.database.prepare("insert into session_message values (?, ?, ?, ?, ?, ?, ?)");
  for (const [id, session, type, seq, text] of [
    ["msg_a2", "ses_a", "user", 2, "a"], ["msg_a9", "ses_a", "assistant", 9, undefined],
    ["msg_b5", "ses_b", "system", 5, "b"],
  ] as const) insert.run(id, session, type, seq, seq, seq,
    JSON.stringify({ ...validMessageData(type, id, seq), ...(text === undefined ? {} : { text }) }));
  fixture.completeMigration();
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

test("queries Sessions and Messages without filling sequence gaps or reading completed V1 residue", async () => {
  const fixture = await queryFixture();
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
        Effect.flatMap(({ query }) => Effect.all({
          sessions: all(query, ({ db }) => db.selectFrom("cotail_session")
            .select(["sessionID", "title", "updatedAt"])
            .orderBy("sessionID")),
          messages: all(query, ({ db }) => db.selectFrom("cotail_message")
            .select(["sessionID", "messageID", "messageSeq"])
            .orderBy("sessionID")
            .orderBy("messageSeq")),
          compiled: query.compile(({ db }) => db.selectFrom("cotail_message")
            .select("messageID")
            .where("messageSeq", ">", 2)),
          plan: Effect.scoped(query.openRead.pipe(Effect.flatMap((read) => read.explain(({ db }) =>
            db.selectFrom("cotail_session").select("sessionID").where("projectID", "=", "prj_a"))))),
        })),
      ),
    ));

    assert.deepEqual(result.sessions.map((row) => ({ ...row })), [
      { sessionID: "ses_a", title: "Alpha", updatedAt: 10 },
      { sessionID: "ses_b", title: "Beta", updatedAt: 20 },
    ]);
    assert.deepEqual(result.messages.map((row) => [row.messageID, row.messageSeq]), [
      ["msg_a2", 2],
      ["msg_a9", 9],
      ["msg_b5", 5],
    ]);
    assert.match(result.compiled.sql, /^with "cotail_session" as/);
    assert.match(result.compiled.sql, /"session_v2"/);
    assert.match(result.compiled.sql, /"session_message"/);
    assert.deepEqual(result.compiled.parameters, [2]);
    assert.ok(result.plan.length > 0);
    assert.ok(result.plan.every((row) => typeof row.detail === "string"));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
