import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import {
  acquireNodeOpenCodeSource,
  documentWitness,
  literal,
  regex,
  searchDirectSessions,
  searchSessionTitles,
  sessionDirectoryExact,
  sessionTitleSearchQuery,
  witnessName,
  type LogicalQueryShape,
  type SessionTitleSearchRequest,
  type SessionTitleTerm,
} from "../src/index.ts";
import {
  indexedOpenCodeV2Fixture,
  trustedSourceProfileFacts,
  validMessageData,
} from "./fixtures/opencode-v2/index.ts";

async function titleFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-title-search-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_a', 'prj', 'a', '/a', 'Alpha Beta', '2', 1, 20),
      ('ses_b', 'prj', 'b', '/b', 'alpha beta', '2', 2, 30),
      ('ses_c', 'other', 'c', '/c', 'Alpha gamma', '2', 3, 40),
      ('ses_d', 'prj', 'd', '/d', null, '2', 4, 50),
      ('ses_e', 'prj', 'e', '/e', 'Alpha Beta', '2', 5, 30);
  `);
  const insert = fixture.database.prepare("insert into session_message values (?, ?, ?, ?, ?, ?, ?)");
  for (const [id, session, created] of [
    ["msg_a", "ses_a", 1],
    ["msg_b", "ses_b", 3],
    ["msg_c", "ses_c", 4],
    ["msg_d", "ses_d", 5],
  ] as const) {
    insert.run(id, session, "user", 0, created, created,
      JSON.stringify(validMessageData("user", id, created)));
  }
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

function termMatch(term: SessionTitleTerm) {
  return (text: Parameters<typeof literal>[0]) => term.kind === "literal"
    ? literal(text, term.value, { case: term.case })
    : regex(text, term.source, { flags: term.flags });
}

async function runSpecialized(
  path: string,
  request: SessionTitleSearchRequest,
  onPayloadValidation?: (messageID: string, messageType: string) => void,
) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({
      path,
      sourceID: "fixture",
      profile: trustedSourceProfileFacts,
      onPayloadValidation,
    }).pipe(Effect.flatMap(({ query }) => searchSessionTitles(query, request))),
  ));
}

async function runGeneric(path: string, request: SessionTitleSearchRequest) {
  const witnesses = request.terms.map((term, index) => documentWitness(
    witnessName(`title-${index}`),
    (eb) => eb.and([
      eb("field", "=", "session.title"),
      termMatch(term)(eb.ref("text")),
    ]),
  ));
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
      Effect.flatMap(({ query }) => searchDirectSessions(query, {
        witnesses,
        sessionPredicate: request.sessionPredicate,
        messageCreatedRange: request.messageCreatedRange,
        window: { sessions: { first: request.limit }, childrenPerSession: 1 },
      })),
    ),
  ));
}

async function compileTitle(path: string, request: SessionTitleSearchRequest) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
      Effect.flatMap(({ query }) => query.compile((context) => sessionTitleSearchQuery(context, request))),
    ),
  ));
}

async function explainTitle(path: string, request: SessionTitleSearchRequest) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
      Effect.flatMap(({ query }) => query.openRead.pipe(Effect.flatMap((read) =>
        read.explain((context) => sessionTitleSearchQuery(context, request))))),
    ),
  ));
}

test("matches generic title witnesses across literal, regex, case, predicate, and activity semantics", async () => {
  const fixture = await titleFixture();
  try {
    const cases: readonly SessionTitleSearchRequest[] = [
      {
        terms: [
          { kind: "literal", value: "Alpha", case: "sensitive" },
          { kind: "literal", value: "Beta", case: "sensitive" },
        ],
        limit: 10,
      },
      {
        terms: [
          { kind: "literal", value: "ALPHA", case: "insensitive" },
          { kind: "literal", value: "beta", case: "insensitive" },
        ],
        limit: 2,
      },
      {
        terms: [
          { kind: "regex", source: "^Alpha" },
          { kind: "regex", source: "Beta$" },
        ],
        limit: 10,
      },
      {
        terms: [
          { kind: "regex", source: "^ALPHA", flags: "i" },
          { kind: "regex", source: "BETA$", flags: "i" },
        ],
        sessionPredicate: sessionDirectoryExact("/b"),
        limit: 10,
      },
      {
        terms: [{ kind: "literal", value: "alpha", case: "insensitive" }],
        messageCreatedRange: { from: 3, to: 4 },
        limit: 10,
      },
    ];

    for (const request of cases) {
      const [specialized, generic] = await Promise.all([
        runSpecialized(fixture.path, request),
        runGeneric(fixture.path, request),
      ]);
      assert.deepEqual(
        specialized.map((session) => session.target.address.sessionID),
        generic.map((group) => group.session.target.address.sessionID),
      );
      assert.deepEqual(
        specialized.map((session) => session.value),
        generic.map((group) => group.session.value),
      );
    }

    const summaries = await runSpecialized(fixture.path, cases[0]!);
    assert.deepEqual(summaries.map((session) => session.target.address.sessionID), ["ses_e", "ses_a"]);
    assert.equal(summaries[0]!.value.directory, "/e");
    assert.equal(summaries[0]!.value.updatedAt, 30);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("compiles and executes without the document, validation, JSON, or unrequested Message worlds", async () => {
  const fixture = await titleFixture();
  try {
    let validations = 0;
    const request = {
      terms: [{ kind: "literal", value: "alpha", case: "insensitive" }],
      sessionPredicate: sessionDirectoryExact("/e"),
      limit: 2,
    } as const;
    const [compiled, plan, result] = await Promise.all([
      compileTitle(fixture.path, request),
      explainTitle(fixture.path, request),
      runSpecialized(fixture.path, request, () => { validations++; }),
    ]);

    assert.deepEqual(result.map((session) => session.target.address.sessionID), ["ses_e"]);
    assert.equal(validations, 0);
    const candidateAt = compiled.sql.indexOf('"candidate_sessions" as');
    const titleAt = compiled.sql.indexOf('"title_qualified_sessions" as');
    assert.ok(candidateAt >= 0 && titleAt > candidateAt);
    assert.match(compiled.sql.slice(candidateAt, titleAt), /"cotail_session"\."directory" = \?/u);
    for (const forbidden of [
      "cotail_document",
      "cotail_validated_message",
      "cotail_validate_message",
      "session_message",
    ]) assert.doesNotMatch(compiled.sql, new RegExp(forbidden, "u"));
    assert.doesNotMatch(compiled.sql, /json_(?:array|each|extract|object|type|valid)|\s->\s/u);
    assert.equal(plan.some(({ detail }) => /session_message/u.test(detail)), false,
      plan.map(({ detail }) => detail).join("\n"));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("uses the Message-created index for activity without validation or scans", async () => {
  const fixture = await titleFixture();
  try {
    let validations = 0;
    const request = {
      terms: [{ kind: "regex", source: "^alpha", flags: "i" }],
      messageCreatedRange: { from: 3 },
      limit: 10,
    } as const;
    const [compiled, plan, result] = await Promise.all([
      compileTitle(fixture.path, request),
      explainTitle(fixture.path, request),
      runSpecialized(fixture.path, request, () => { validations++; }),
    ]);
    const details = plan.map(({ detail }) => detail);

    assert.deepEqual(result.map((session) => session.target.address.sessionID), ["ses_c", "ses_b"]);
    assert.equal(validations, 0);
    assert.match(compiled.sql, /from "session_message" where "time_created" >= \?/u);
    assert.doesNotMatch(compiled.sql, /cotail_document|cotail_validated_message|cotail_validate_message|json_/u);
    assert.equal(details.some((detail) => /SCAN session_message/u.test(detail)), false, details.join("\n"));
    assert.equal(details.some((detail) => /SEARCH session_message .*time_created/u.test(detail)), true,
      details.join("\n"));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("ignores malformed payloads in unrelated active Sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cotail-title-isolation-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_match', 'prj', 'match', '/match', 'Needle title', '2', 1, 20),
      ('ses_noise', 'prj', 'noise', '/noise', 'Other title', '2', 1, 30);
  `);
  fixture.database.prepare("insert into session_message values (?, ?, 'user', 0, 10, 10, ?)")
    .run("msg_match", "ses_match", JSON.stringify(validMessageData("user", "msg_match", 10)));
  fixture.database.prepare("insert into session_message values (?, ?, 'user', 0, 10, 10, ?)")
    .run("msg_noise", "ses_noise", "{malformed");
  fixture.database.exec(`
    update session_v2
    set cost = 'not-a-number', tokens_input = 'not-a-number', parent_id = 123
    where id = 'ses_match'
  `);
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  try {
    let validations = 0;
    const result = await runSpecialized(path, {
      terms: [{ kind: "literal", value: "Needle" }],
      messageCreatedRange: { from: 10 },
      limit: 10,
    }, () => { validations++; });
    assert.deepEqual(result.map((session) => session.target.address.sessionID), ["ses_match"]);
    assert.equal(validations, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validates title terms, activity bounds, and the positive page limit", () => {
  const query = {} as LogicalQueryShape;
  const valid = { terms: [{ kind: "literal", value: "x" }] as const, limit: 1 };
  for (const request of [
    { ...valid, terms: [] },
    { ...valid, limit: 0 },
    { ...valid, limit: 1.5 },
    { ...valid, limit: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, messageCreatedRange: {} },
    { ...valid, messageCreatedRange: { from: 2, to: 2 } },
    { ...valid, messageCreatedRange: { from: Number.NaN } },
    { ...valid, terms: [{ kind: "literal", value: "x", case: "folded" }] },
    { ...valid, terms: [{ kind: "regex", source: "x", flags: "g" }] },
    { ...valid, terms: [{ kind: "other", value: "x" }] },
  ]) {
    assert.throws(() => searchSessionTitles(query, request as SessionTitleSearchRequest));
  }
});
