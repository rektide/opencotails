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
import { directSessionSearchQuery, searchDirectSessions } from "../src/operations/direct-search.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { indexedOpenCodeV2Fixture, trustedSourceProfileFacts, validMessageData } from "./fixtures/opencode-v2/index.ts";

async function searchFixture(unrelatedMessages = 0): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-search-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
       ('ses_a', 'prj', 'a', '/a', 'A', '2', 1, 10),
       ('ses_b', 'prj', 'b', '/b', 'B', '2', 2, 20),
       ('ses_c', 'prj', 'c', '/c', 'C', '2', 3, 20),
       ('ses_d', 'prj', 'd', '/d', 'D', '2', 4, 30);
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
  for (let index = 0; index < unrelatedMessages; index++) {
    const id = `msg_noise_${index}`;
    insert.run(id, "ses_d", "system", index, index + 10, index + 10,
      JSON.stringify({ ...validMessageData("system", id, index + 10), text: "alpha noise" }));
  }
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

const alpha = documentWitness(witnessName("alpha"), (eb) => literal(eb.ref("text"), "alpha"));
const beta = documentWitness(witnessName("beta"), (eb) => literal(eb.ref("text"), "beta"));

async function runSearch(
  path: string,
  options: Parameters<typeof searchDirectSessions>[1],
  onPayloadValidation?: (messageID: string, messageType: string) => void,
) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts, onPayloadValidation }).pipe(
      Effect.flatMap(({ query }) => searchDirectSessions(query, options)),
    ),
  ));
}

async function compileSearch(path: string, options: Parameters<typeof searchDirectSessions>[1]) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
      Effect.flatMap(({ query }) => query.compile(({ db, source }) => directSessionSearchQuery(db, source, options))),
    ),
  ));
}

async function explainSearch(path: string, options: Parameters<typeof searchDirectSessions>[1]) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
      Effect.flatMap(({ query }) => query.openRead.pipe(Effect.flatMap((read) =>
        read.explain(({ db, source }) => directSessionSearchQuery(db, source, options))))),
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
    assert.deepEqual(
      withoutEvidence.map((group) => group.truncated),
      withEvidence.map((group) => group.truncated),
    );
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

test("compiles visible qualification, root-window, child-window, and optional hydration stages", async () => {
  const fixture = await searchFixture();
  try {
    const request = {
      witnesses: [alpha, beta],
      sessionPredicate: sessionDirectoryExact("/b"),
      window: {
        sessions: { first: 2, after: { updatedAt: 30, sessionID: "ses_z" } },
        childrenPerSession: 2,
        globalHitLimit: 3,
      },
    } as const;
    const [withoutEvidence, withEvidence] = await Promise.all([
      compileSearch(fixture.path, { ...request, evidence: false }),
      compileSearch(fixture.path, { ...request, evidence: true }),
    ]);
    const operation = withoutEvidence.sql.slice(withoutEvidence.sql.indexOf(', "candidate_sessions" as ('));
    const candidateAt = operation.indexOf(', "candidate_sessions" as (');
    const witnessAt = operation.indexOf(', "witness_qualified_sessions" as (');
    const selectedAt = operation.indexOf(', "selected_sessions" as (');
    const matchingAt = operation.indexOf(', "matching_documents" as (');
    const rankedAt = operation.indexOf(', "ranked_documents" as (');
    const totalsAt = operation.indexOf(', "session_totals" as (');
    const hitsAt = operation.indexOf(', "selected_hits" as (');
    assert.ok(candidateAt === 0 && witnessAt > candidateAt && selectedAt > witnessAt
      && matchingAt > selectedAt && rankedAt > matchingAt && totalsAt > rankedAt && hitsAt > totalsAt);

    const candidates = operation.slice(candidateAt, witnessAt);
    const qualified = operation.slice(witnessAt, selectedAt);
    const selected = operation.slice(selectedAt, matchingAt);
    const matching = operation.slice(matchingAt, rankedAt);
    const hits = operation.slice(hitsAt);
    assert.match(candidates, /where "cotail_session"\."directory" = \?/u);
    assert.match(candidates, /"cotail_session"\."updatedAt" < \?/u);
    assert.doesNotMatch(candidates, /limit/u);
    assert.match(qualified, /exists \(select "cotail_document"\."documentKey"/u);
    assert.equal((qualified.match(/exists \(/gu) ?? []).length, 2);
    assert.doesNotMatch(qualified, /limit/u);
    assert.match(selected, /order by "sessionUpdatedAt" desc, "sessionID" desc limit \?/u);
    assert.match(matching, /from "selected_sessions" cross join "cotail_document"/u);
    assert.match(matching, /"cotail_document"\."sessionID" = "selected_sessions"\."sessionID"/u);
    assert.match(hits, /where "sessionRank" <= \?/u);
    assert.match(hits, /limit \?/u);

    assert.doesNotMatch(operation, /hydrated_hits|evidence_message/u);
    assert.doesNotMatch(operation, /"sourceJSON"|"messageType"/u);
    const evidenceOperation = withEvidence.sql.slice(withEvidence.sql.indexOf(', "candidate_sessions" as ('));
    const hydratedAt = evidenceOperation.indexOf(', "hydrated_hits" as (');
    assert.ok(hydratedAt > evidenceOperation.indexOf(', "selected_hits" as ('));
    assert.match(evidenceOperation.slice(hydratedAt), /left join "cotail_message" as "evidence_message"/u);
    assert.match(evidenceOperation.slice(hydratedAt), /"evidence_message"\."sourceJSON"/u);
    assert.match(evidenceOperation.slice(hydratedAt), /"evidence_message"\."messageType"/u);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("does not window recent nonmatches ahead of later witness-qualified Sessions", async () => {
  const fixture = await searchFixture();
  try {
    const result = await runSearch(fixture.path, {
      witnesses: [alpha, beta],
      window: { sessions: { first: 3 }, childrenPerSession: 1 },
    });
    assert.deepEqual(result.map((group) => group.session.value.sessionID), ["ses_c", "ses_b", "ses_a"]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("payload hydration adds validation only for the selected Message hit", async () => {
  const fixture = await searchFixture();
  try {
    const withoutHydration: string[] = [];
    const withHydration: string[] = [];
    const request = {
      witnesses: [alpha],
      window: { sessions: { first: 1 }, childrenPerSession: 1 },
    } as const;
    const [withoutEvidence, withEvidence] = await Promise.all([
      runSearch(fixture.path, { ...request, evidence: false }, (messageID) => withoutHydration.push(messageID)),
      runSearch(fixture.path, { ...request, evidence: true }, (messageID) => withHydration.push(messageID)),
    ]);
    assert.deepEqual(
      withoutEvidence.map((group) => group.session.target),
      withEvidence.map((group) => group.session.target),
    );
    const count = (values: readonly string[], id: string) => values.filter((value) => value === id).length;
    const ids = new Set([...withoutHydration, ...withHydration]);
    assert.deepEqual([...ids].filter((id) => count(withHydration, id) !== count(withoutHydration, id)), ["msg_c0"]);
    assert.equal(count(withHydration, "msg_c0"), count(withoutHydration, "msg_c0") + 1);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("indexed plan drives post-window document and hydration work from selected identities", async () => {
  const fixture = await searchFixture();
  try {
    const request = {
      witnesses: [alpha],
      sessionPredicate: sessionDirectoryExact("/b"),
      window: { sessions: { first: 1 }, childrenPerSession: 1 },
    } as const;
    const [withoutEvidence, withEvidence] = await Promise.all([
      explainSearch(fixture.path, { ...request, evidence: false }),
      explainSearch(fixture.path, { ...request, evidence: true }),
    ]);
    const details = withEvidence.map(({ detail }) => detail);
    assert.equal(details.filter((detail) => /MATERIALIZE selected_sessions/u.test(detail)).length, 1);
    const matchingOuter = details.findIndex((detail) => /SCAN selected_sessions/u.test(detail));
    const matchingSearch = details.findIndex((detail, index) => index > matchingOuter
      && /SEARCH cotail_document .*\(sessionID=\?\)/u.test(detail));
    assert.ok(matchingOuter >= 0 && matchingSearch > matchingOuter,
      `selected Sessions do not drive matching Documents:\n${details.join("\n")}`);

    const hydration = details.findIndex((detail) => /MATERIALIZE hydrated_hits/u.test(detail));
    const payloadSearch = details.findIndex((detail, index) => index > hydration
      && /SEARCH session_message .*\(id=\?\)/u.test(detail));
    assert.ok(hydration >= 0 && matchingOuter > hydration && matchingSearch > matchingOuter && payloadSearch > matchingSearch,
      `selected hits do not drive payload lookup:\n${details.join("\n")}`);
    assert.equal(details.slice(hydration).some((detail) => /SCAN session_message/u.test(detail)), false);
    assert.equal(withoutEvidence.some(({ detail }) => /hydrated_hits/u.test(detail)), false);
    // Witness qualification remains a correlated document-world residual and
    // may scan Messages before the selected Session page is established.
    assert.equal(details.some((detail) => /CORRELATED SCALAR SUBQUERY/u.test(detail)), true);
    assert.equal(details.slice(0, matchingOuter).some((detail) => /SCAN session_message/u.test(detail)), true);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("unrelated candidate Messages do not change selected results or hydration demand", async () => {
  const fixture = await searchFixture(40);
  try {
    const withoutHydration: string[] = [];
    const withHydration: string[] = [];
    const request = {
      witnesses: [alpha],
      sessionPredicate: sessionDirectoryExact("/b"),
      window: { sessions: { first: 1 }, childrenPerSession: 1 },
    } as const;
    const [withoutEvidence, withEvidence] = await Promise.all([
      runSearch(fixture.path, { ...request, evidence: false }, (id) => withoutHydration.push(id)),
      runSearch(fixture.path, { ...request, evidence: true }, (id) => withHydration.push(id)),
    ]);
    assert.deepEqual(withoutEvidence.map((group) => [group.session.value.sessionID, group.truncated]), [["ses_b", true]]);
    assert.deepEqual(withEvidence.map((group) => [group.session.value.sessionID, group.truncated]), [["ses_b", true]]);
    for (let index = 0; index < 40; index++) {
      const id = `msg_noise_${index}`;
      assert.equal(
        withHydration.filter((value) => value === id).length,
        withoutHydration.filter((value) => value === id).length,
      );
    }
    assert.equal(
      withHydration.filter((id) => id === "msg_b0").length,
      withoutHydration.filter((id) => id === "msg_b0").length + 1,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
