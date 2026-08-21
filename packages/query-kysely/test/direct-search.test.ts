import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { literal } from "../src/direct/match.ts";
import { sessionDirectoryExact } from "../src/direct/session.ts";
import { documentWitness, witnessName } from "../src/direct/witness.ts";
import { searchDirectSessions } from "../src/operations/direct-search.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { openCodeV2Fixture, validMessageData } from "./fixtures/opencode-v2.ts";

async function searchFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-search-"));
  const path = join(directory, "source.db");
  const fixture = openCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_a', 'prj', 'a', '/a', 'A', '2', 1, 10),
      ('ses_b', 'prj', 'b', '/b', 'B', '2', 2, 20),
      ('ses_c', 'prj', 'c', '/c', 'C', '2', 3, 20);
  `);
  const insert = fixture.database.prepare("insert into session_message values (?, ?, ?, ?, ?, ?, ?)");
  for (const [id, session, type, seq, created, updated, text] of [
    ["msg_a0", "ses_a", "user", 0, 1, 1, "alpha"],
    ["msg_a1", "ses_a", "system", 1, 2, 2, "beta"],
    ["msg_b0", "ses_b", "user", 0, 1, 11, "alpha beta"],
    ["msg_b1", "ses_b", "system", 1, 2, 12, "alpha one"],
    ["msg_b2", "ses_b", "synthetic", 2, 3, 13, "alpha two"],
    ["msg_c0", "ses_c", "user", 0, 1, 21, "alpha"],
    ["msg_c1", "ses_c", "system", 1, 2, 22, "beta"],
  ] as const) insert.run(id, session, type, seq, created, updated,
    JSON.stringify({ ...validMessageData(type, id, created), text }));
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

const alpha = documentWitness(witnessName("alpha"), (eb) => literal(eb.ref("text"), "alpha"));
const beta = documentWitness(witnessName("beta"), (eb) => literal(eb.ref("text"), "beta"));

async function runSearch(
  path: string,
  options: Parameters<typeof searchDirectSessions>[1],
) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture" }).pipe(
      Effect.flatMap(({ query }) => searchDirectSessions(query, options)),
    ),
  ));
}

test("groups independent witnesses with per-Session limits and stable evidence", async () => {
  const fixture = await searchFixture();
  try {
    const result = await runSearch(fixture.path, {
      witnesses: [alpha, beta],
      evidence: true,
      window: { sessions: { first: 2 }, childrenPerSession: 2 },
    });
    assert.deepEqual(result.map((group) => group.session.target.address.sessionID), ["ses_c", "ses_b"]);
    assert.deepEqual(result.map((group) => group.children.length), [2, 2]);
    assert.deepEqual(result[0]!.children.map((child) => child.witness), ["alpha", "beta"]);
    assert.equal(result[0]!.children[0]!.document.value.field, "user.text");
    assert.equal(result[0]!.children[0]!.document.value.excerpt, "alpha");
    const evidence = result.flatMap((group) => group.children);
    assert.equal(evidence[0]!.document.revision?.messageUpdatedAt, 21);
    assert.match(evidence[0]!.document.revision?.payloadHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(evidence[0]!.document.revision?.payloadHash, createHash("sha256")
      .update('{"id":"msg_c0","text":"alpha","time":{"created":1},"type":"user"}').digest("hex"));
    assert.notEqual(evidence[0]!.document.revision?.payloadHash, JSON.stringify(evidence[0]!.document.target.address));
    assert.ok(Number.isSafeInteger(evidence[0]!.document.read.observedAt));
    assert.equal(new Set(evidence.map((child) => child.document.read.observedAt)).size, 1);
    assert.equal(new Set(evidence.map((child) => child.document.read.readScopeID)).size, 1);
    assert.equal("revision" in evidence[0]!.document.value, false);
    assert.equal(result[1]!.truncated, true);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("Session-title evidence is observed without inventing a Message revision", async () => {
  const fixture = await searchFixture();
  try {
    const title = documentWitness(witnessName("title"), (eb) => literal(eb.ref("text"), "C"));
    const result = await runSearch(fixture.path, {
      witnesses: [title], evidence: true,
      window: { sessions: { first: 1 }, childrenPerSession: 1 },
    });
    const document = result[0]!.children[0]!.document;
    assert.equal(document.value.field, "session.title");
    assert.equal(document.revision, undefined);
    assert.ok(document.read.observedAt > 0);
    assert.ok(document.read.readScopeID.length > 0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("evidence policy preserves Session targets and keyset tie-breakers", async () => {
  const fixture = await searchFixture();
  try {
    const common = { witnesses: [alpha, beta], window: { sessions: { first: 3 }, childrenPerSession: 3 } } as const;
    const [withEvidence, withoutEvidence, after] = await Promise.all([
      runSearch(fixture.path, { ...common, evidence: true }),
      runSearch(fixture.path, { ...common, evidence: false }),
      runSearch(fixture.path, {
        witnesses: [alpha, beta],
        evidence: true,
        window: { sessions: { first: 2, after: { updatedAt: 20, sessionID: "ses_c" } }, childrenPerSession: 1 },
      }),
    ]);
    const targets = (groups: typeof withEvidence) => groups.map((group) => group.session.target);
    assert.deepEqual(targets(withEvidence), targets(withoutEvidence));
    assert.ok(withoutEvidence.every((group) => group.children.length === 0));
    assert.deepEqual(after.map((group) => group.session.value.sessionID), ["ses_b", "ses_a"]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("global hit limit follows Session-page order without dropping groups", async () => {
  const fixture = await searchFixture();
  try {
    const result = await runSearch(fixture.path, {
      witnesses: [alpha, beta],
      evidence: true,
      window: { sessions: { first: 3 }, childrenPerSession: 3, globalHitLimit: 2 },
    });
    assert.deepEqual(result.map((group) => group.session.value.sessionID), ["ses_c", "ses_b", "ses_a"]);
    assert.deepEqual(result.map((group) => group.children.length), [2, 0, 0]);
    assert.deepEqual(result.map((group) => group.truncated), [false, true, true]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("applies a contextual Session predicate before witness qualification", async () => {
  const fixture = await searchFixture();
  try {
    const result = await runSearch(fixture.path, {
      witnesses: [alpha],
      sessionPredicate: sessionDirectoryExact("/b"),
      window: { sessions: { first: 3 }, childrenPerSession: 1 },
    });
    assert.deepEqual(result.map((group) => group.session.value.sessionID), ["ses_b"]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
