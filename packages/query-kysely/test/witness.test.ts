import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { literal } from "../src/direct/match.ts";
import { documentWitness, witnessName } from "../src/direct/witness.ts";
import { searchDirectSessions } from "../src/operations/direct-search.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { indexedOpenCodeV2Fixture, trustedSourceProfileFacts, validMessageData } from "./fixtures/opencode-v2/index.ts";

async function witnessFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-witness-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_separate', 'prj', 's', '/s', null, '2', 1, 1),
      ('ses_same', 'prj', 'm', '/m', null, '2', 2, 2);
  `);
  const insert = fixture.database.prepare("insert into session_message values (?, ?, ?, ?, ?, ?, ?)");
  for (const [id, session, type, seq, created, text] of [
    ["msg_s0", "ses_separate", "user", 0, 1, "alpha"],
    ["msg_s1", "ses_separate", "system", 1, 2, "beta"],
    ["msg_m0", "ses_same", "user", 0, 1, "alpha beta"],
  ] as const) insert.run(id, session, type, seq, created, created,
    JSON.stringify({ ...validMessageData(type, id, created), text }));
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

const alpha = documentWitness(witnessName("alpha"), (eb) => literal(eb.ref("text"), "alpha"));
const beta = documentWitness(witnessName("beta"), (eb) => literal(eb.ref("text"), "beta"));
const same = documentWitness(witnessName("same"), (eb) => eb.and([
  literal(eb.ref("text"), "alpha"),
  literal(eb.ref("text"), "beta"),
]));

test("named witness uses the explicit owner expression under a Session alias", async () => {
  const fixture = await witnessFixture();
  try {
    const compiled = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
        Effect.flatMap(({ query }) => query.compile(({ db }) => db.selectFrom("cotail_session as owner")
          .select("owner.sessionID")
          .where((eb) => alpha.forSession({ eb, sessionID: eb.ref("owner.sessionID") })))),
      ),
    ));
    assert.match(compiled.sql, /"cotail_document"\."sessionID" = "owner"\."sessionID"/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("multiple witnesses are independent while one witness can require the same document", async () => {
  const fixture = await witnessFixture();
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
        Effect.flatMap(({ query }) => Effect.all({
          independent: searchDirectSessions(query, {
            witnesses: [alpha, beta], evidence: false,
            window: { sessions: { first: 10 }, childrenPerSession: 1 },
          }),
          same: searchDirectSessions(query, {
            witnesses: [same], evidence: false,
            window: { sessions: { first: 10 }, childrenPerSession: 1 },
          }),
        })),
      ),
    ));
    assert.deepEqual(result.independent.map((group) => group.session.value.sessionID), ["ses_same", "ses_separate"]);
    assert.deepEqual(result.same.map((group) => group.session.value.sessionID), ["ses_same"]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
