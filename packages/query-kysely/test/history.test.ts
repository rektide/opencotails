import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { all } from "../src/query/logical-query.ts";
import { sessionUpdatedRange } from "../src/direct/session.ts";
import { sessionID } from "../src/domain/identifier.ts";
import { readSessionHistory, sessionHistoryQuery } from "../src/operations/history.ts";
import { getSession } from "../src/operations/resolve.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { indexedOpenCodeV2Fixture, trustedSourceProfileFacts, validMessageData } from "./fixtures/opencode-v2/index.ts";

async function historyFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-history-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_a', 'p1', 'a', '/work/a', 'A', '2', 1, 10),
      ('ses_b', 'p1', 'b', '/work/b', 'B', '2', 2, 20),
      ('ses_c', 'p2', 'c', '/other/c', 'C', '2', 3, 20),
      ('ses_old', 'p1', 'old', '/work/old', 'Old', '2', 1, 5);
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
    ["msg_old_a", "ses_old", "user", 0, 1], ["msg_old_b", "ses_old", "user", 1, 6],
  ] as const) insert.run(id, session, type, seq, time, time, JSON.stringify(validMessageData(type, id, time)));
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

async function history(path: string, request: Parameters<typeof readSessionHistory>[1]) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
      Effect.flatMap(({ query }) => readSessionHistory(query, request)),
    ),
  ));
}

async function withQuery<A>(path: string, run: (query: Parameters<typeof getSession>[0]) => Effect.Effect<A, unknown>) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
      Effect.flatMap(({ query }) => run(query)),
    ),
  ));
}

const idOf = (row: { readonly session: { readonly target: { readonly address: { readonly sessionID: string } } } }) =>
  row.session.target.address.sessionID;

test("returns canonical Session observations with one-pass activity counts per variant", async () => {
  const fixture = await historyFixture();
  try {
    const rows = await history(fixture.path, {
      predicate: sessionUpdatedRange({ from: 15 }),
      since: 5,
    });
    assert.deepEqual(rows.map((row) => [idOf(row), row.activity]), [
      ["ses_c", { since: 5, messagesTotal: 1, messagesSince: 1 }],
      ["ses_b", { since: 5, messagesTotal: 7, messagesSince: 3 }],
    ]);
    assert.equal(rows.some((row) => idOf(row) === "ses_legacy"), false);
    // A Session outside the predicate keeps its Messages out of the listing and
    // out of every qualified Session's counts.
    assert.equal(rows.some((row) => idOf(row) === "ses_old"), false);

    const tighter = await history(fixture.path, { since: 6 });
    const sesB = tighter.find((row) => idOf(row) === "ses_b");
    assert.deepEqual(sesB?.activity, { since: 6, messagesTotal: 7, messagesSince: 2 });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("orders ties deterministically, keeps zero-message Sessions, and applies limits", async () => {
  const fixture = await historyFixture();
  try {
    const [unlimited, one] = await Promise.all([
      history(fixture.path, { since: 0 }),
      history(fixture.path, { since: 0, limit: 1 }),
    ]);
    assert.deepEqual(unlimited.map(idOf), ["ses_c", "ses_b", "ses_a", "ses_old"]);
    assert.deepEqual(unlimited[2]!.activity, { since: 0, messagesTotal: 0, messagesSince: 0 });
    assert.deepEqual(unlimited[3]!.activity, { since: 0, messagesTotal: 2, messagesSince: 2 });
    assert.deepEqual(one.map(idOf), ["ses_c"]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("history reports equal the exact lookup report and share one read scope", async () => {
  const fixture = await historyFixture();
  try {
    const rows = await history(fixture.path, { since: 0 });
    const exact = await withQuery(fixture.path, (query) => getSession(query, sessionID("ses_b")));
    const item = rows.find((row) => idOf(row) === "ses_b");

    assert.deepEqual(
      { target: item!.session.target, value: item!.session.value },
      { target: exact.target, value: exact.value },
    );
    assert.equal(new Set(rows.map((row) => row.session.read.readScopeID)).size, 1);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects invalid limits and cutoffs before opening a read", () => {
  const query = {} as Parameters<typeof readSessionHistory>[0];
  for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => readSessionHistory(query, { since: 0, limit }), /positive safe integer/);
  }
  for (const since of [Number.NaN, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => readSessionHistory(query, { since }), /safe integer/);
  }
});

test("qualifies Sessions first and restricts the one grouped Message aggregate to them", async () => {
  const fixture = await historyFixture();
  try {
    const request = {
      predicate: sessionUpdatedRange({ from: 15 }),
      since: 5,
      limit: 2,
    } as const;
    const compiled = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
        Effect.flatMap(({ query }) => query.compile(({ db }) => sessionHistoryQuery(db, request))),
      ),
    ));

    const qualifiedAt = compiled.sql.indexOf(', "qualified_sessions" as (');
    const activityAt = compiled.sql.indexOf(', "session_activity" as (');
    const mainAt = compiled.sql.indexOf(') select "cotail_session"."sessionID"');
    assert.ok(qualifiedAt > 0 && activityAt > qualifiedAt && mainAt > activityAt);
    const qualified = compiled.sql.slice(qualifiedAt, activityAt);
    const activity = compiled.sql.slice(activityAt, mainAt);
    const main = compiled.sql.slice(mainAt);

    // The predicate, deterministic order, and limit qualify Sessions before any
    // Message work happens; the predicate parameter precedes the limit.
    assert.match(qualified, /where "cotail_session"\."updatedAt" >= \?/);
    assert.match(
      qualified,
      /order by "cotail_session"\."updatedAt" desc, "cotail_session"\."sessionID" desc/,
    );
    assert.match(qualified, /limit \?\)$/);

    // Exactly one grouped aggregate, and it inner-joins the qualified Sessions
    // before grouping, so Messages of non-qualified Sessions are never grouped.
    assert.equal((compiled.sql.match(/count\(\*\)/g) ?? []).length, 1);
    assert.equal((compiled.sql.match(/group by/g) ?? []).length, 1);
    assert.match(
      activity,
      /from "cotail_message" inner join "qualified_sessions" on "qualified_sessions"\."sessionID" = "cotail_message"\."sessionID"/,
    );
    assert.match(activity, /sum\(case when "cotail_message"\."createdAt" >= \? then 1 else 0 end\)/);
    assert.match(activity, /group by "cotail_message"\."sessionID"$/);
    assert.doesNotMatch(activity, /left join/);

    // Counts join back left so zero-message qualified Sessions survive.
    assert.match(main, /inner join "qualified_sessions"/);
    assert.match(main, /left join "session_activity"/);
    assert.match(main, /coalesce\("session_activity"\."messagesTotal", 0\)/);
    assert.match(main, /coalesce\("session_activity"\."messagesSince", 0\)/);
    assert.doesNotMatch(compiled.sql, /\(select count/);
    assert.doesNotMatch(compiled.sql, /coalesce\(\(select/);
    assert.deepEqual(compiled.parameters, [15, 2, 5]);

  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("acquisition and history skip payload validation while content evaluates it lazily", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cotail-lazy-validation-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values ('ses_bad', 'p1', 'bad', '/bad', 'Bad', '2', 1, 1)
  `);
  fixture.database.prepare("insert into session_message values (?, ?, ?, ?, ?, ?, ?)")
    .run("msg_bad", "ses_bad", "system", 0, 1, 1, JSON.stringify({ time: { created: 1 }, text: 42 }));
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();

  let validations = 0;
  try {
    await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({
        path,
        sourceID: "fixture",
        profile: trustedSourceProfileFacts,
        onPayloadValidation: () => { validations++; },
      }).pipe(
        Effect.flatMap(({ query }) => readSessionHistory(query, { since: 0 })
          .pipe(Effect.tap(() => Effect.sync(() => assert.equal(validations, 0))))),
      ),
    ));
    assert.equal(validations, 0);

    await assert.rejects(Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({
        path,
        sourceID: "fixture",
        profile: trustedSourceProfileFacts,
        onPayloadValidation: () => { validations++; },
      }).pipe(
        Effect.flatMap(({ query }) => all(query, ({ db }) => db.selectFrom("cotail_document").select("documentKey"))),
      ),
    )), /expected string/);
    assert.ok(validations > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
