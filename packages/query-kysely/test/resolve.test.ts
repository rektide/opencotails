import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { sessionDirectoryExact, sessionIDs } from "../src/direct/session.ts";
import { sessionID } from "../src/domain/identifier.ts";
import {
  findLatestSession,
  getSession,
  listSessions,
  SessionNotFoundError,
} from "../src/operations/resolve.ts";
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

async function withQuery<A>(path: string, run: (query: Parameters<typeof getSession>[0]) => Effect.Effect<A, unknown>) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture" }).pipe(
      Effect.flatMap(({ query }) => run(query)),
    ),
  ));
}

test("gets one exact Session observation and reports typed not-found", async () => {
  const fixture = await resolveFixture();
  try {
    const found = await withQuery(fixture.path, (query) => getSession(query, sessionID("ses_b")));
    assert.equal(found.target.address.sessionID, "ses_b");
    assert.equal(found.target.source.sourceID, "fixture");
    assert.equal(found.value.lineage.parentSessionID, "ses_a");
    assert.equal(found.value.usage.tokens.input, 0);

    await assert.rejects(
      withQuery(fixture.path, (query) => getSession(query, sessionID("ses_legacy"))),
      (error: unknown) => error instanceof SessionNotFoundError && error.sessionID === "ses_legacy",
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("latest is explicitly heuristic and uses a deterministic Session ID tie-breaker", async () => {
  const fixture = await resolveFixture();
  try {
    const latest = await withQuery(fixture.path, (query) => findLatestSession(query));
    assert.equal(latest?.target.address.sessionID, "ses_c");

    const work = await withQuery(fixture.path, (query) => findLatestSession(query, sessionDirectoryExact("/work")));
    assert.equal(work?.target.address.sessionID, "ses_b");

    const missing = await withQuery(fixture.path, (query) => findLatestSession(query, sessionIDs([])));
    assert.equal(missing, undefined);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("lists deterministic keyset pages in either explicit order", async () => {
  const fixture = await resolveFixture();
  try {
    const first = await withQuery(fixture.path, (query) => listSessions(query, {
      order: "updated-desc",
      page: { first: 1 },
    }));
    assert.deepEqual(first.sessions.map((session) => session.target.address.sessionID), ["ses_c"]);
    assert.deepEqual(first.next, { updatedAt: 20, sessionID: "ses_c" });
    assert.equal(new Set(first.sessions.map((session) => session.read.readScopeID)).size, 1);

    const second = await withQuery(fixture.path, (query) => listSessions(query, {
      order: "updated-desc",
      page: { first: 1, after: first.next },
    }));
    assert.deepEqual(second.sessions.map((session) => session.target.address.sessionID), ["ses_b"]);
    assert.deepEqual(second.next, { updatedAt: 20, sessionID: "ses_b" });

    const third = await withQuery(fixture.path, (query) => listSessions(query, {
      order: "updated-desc",
      page: { first: 1, after: second.next },
    }));
    assert.deepEqual(third.sessions.map((session) => session.target.address.sessionID), ["ses_a"]);
    assert.equal(third.next, undefined);

    const ascending = await withQuery(fixture.path, (query) => listSessions(query, {
      order: "updated-asc",
      page: { first: 2 },
    }));
    assert.deepEqual(ascending.sessions.map((session) => session.target.address.sessionID), ["ses_a", "ses_b"]);
    assert.deepEqual(ascending.next, { updatedAt: 20, sessionID: "ses_b" });

    const ascendingSecond = await withQuery(fixture.path, (query) => listSessions(query, {
      order: "updated-asc",
      page: { first: 2, after: ascending.next },
    }));
    assert.deepEqual(ascendingSecond.sessions.map((session) => session.target.address.sessionID), ["ses_c"]);
    assert.equal(ascendingSecond.next, undefined);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects invalid page sizes and cursors before opening a read", async () => {
  const fixture = await resolveFixture();
  try {
    for (const first of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => listSessions({} as Parameters<typeof listSessions>[0], {
        order: "updated-desc", page: { first },
      }), /positive safe integer/);
    }
    assert.throws(() => listSessions({} as Parameters<typeof listSessions>[0], {
      order: "updated-desc", page: { first: 1, after: { updatedAt: -1, sessionID: "ses_a" } },
    }), /cursor/);
    assert.throws(() => listSessions({} as Parameters<typeof listSessions>[0], {
      order: "updated-desc", page: { first: 1, after: { updatedAt: 1, sessionID: " " } },
    }), /cursor/);

    const maximum = await withQuery(fixture.path, (query) => listSessions(query, {
      order: "updated-desc", page: { first: Number.MAX_SAFE_INTEGER },
    }));
    assert.equal(maximum.sessions.length, 3);
    assert.equal(maximum.next, undefined);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
