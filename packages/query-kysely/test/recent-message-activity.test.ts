import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import {
  acquireNodeOpenCodeSource,
  readRecentMessageActivity,
  recentMessageActivityQuery,
  type LogicalQueryShape,
  type RecentMessageActivityRequest,
} from "../src/index.ts";
import {
  indexedOpenCodeV2Fixture,
  trustedSourceProfileFacts,
} from "./fixtures/opencode-v2/index.ts";

async function activityFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-recent-activity-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values
      ('ses_a', 'prj', 'a', '/a', 'Alpha', '2', 1, 20),
      ('ses_b', 'prj', 'b', '/b', null, '2', 2, 30);
    insert into session_message values
      ('msg_old', 'ses_a', 'user', 0, 10, 11, '{malformed'),
      ('msg_tie_a', 'ses_a', 'assistant', 1, 20, 21, '{also-malformed'),
      ('msg_tie_b', 'ses_b', 'synthetic', 0, 20, 22, 'not-json'),
      ('msg_new', 'ses_b', 'shell', 1, 30, 31, '');
  `);
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

test("returns bounded Message metadata with stable identity and ordering", async () => {
  const fixture = await activityFixture();
  try {
    let validations = 0;
    const rows = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({
        path: fixture.path,
        sourceID: "fixture-source",
        profile: trustedSourceProfileFacts,
        onPayloadValidation: () => { validations++; },
      }).pipe(Effect.flatMap(({ query }) => readRecentMessageActivity(query, {
        messageCreatedRange: { from: 20, to: 31 },
        limit: 3,
      }))),
    ));

    assert.equal(validations, 0);
    assert.deepEqual(rows.map((row) => row.target), [
      {
        source: { kind: "opencode-v2", sourceID: "fixture-source" },
        address: {
          kind: "message",
          session: { kind: "session", sessionID: "ses_b" },
          messageID: "msg_new",
        },
      },
      {
        source: { kind: "opencode-v2", sourceID: "fixture-source" },
        address: {
          kind: "message",
          session: { kind: "session", sessionID: "ses_b" },
          messageID: "msg_tie_b",
        },
      },
      {
        source: { kind: "opencode-v2", sourceID: "fixture-source" },
        address: {
          kind: "message",
          session: { kind: "session", sessionID: "ses_a" },
          messageID: "msg_tie_a",
        },
      },
    ]);
    assert.deepEqual(rows.map((row) => row.value), [
      {
        messageType: "shell", messageSeq: 1, createdAt: 30, updatedAt: 31,
        session: { title: null, directory: "/b" },
      },
      {
        messageType: "synthetic", messageSeq: 0, createdAt: 20, updatedAt: 22,
        session: { title: null, directory: "/b" },
      },
      {
        messageType: "assistant", messageSeq: 1, createdAt: 20, updatedAt: 21,
        session: { title: "Alpha", directory: "/a" },
      },
    ]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("uses the Message-created index without scans, payload worlds, or validation", async () => {
  const fixture = await activityFixture();
  try {
    const request = { messageCreatedRange: { from: 20 }, limit: 2 } as const;
    const configured = () => acquireNodeOpenCodeSource({
      path: fixture.path,
      sourceID: "fixture-source",
      profile: trustedSourceProfileFacts,
    });
    const [compiled, plan] = await Promise.all([
      Effect.runPromise(Effect.scoped(configured().pipe(Effect.flatMap(({ query }) =>
        query.compile((context) => recentMessageActivityQuery(context, request)))))),
      Effect.runPromise(Effect.scoped(configured().pipe(Effect.flatMap(({ query }) =>
        query.openRead.pipe(Effect.flatMap((read) =>
          read.explain((context) => recentMessageActivityQuery(context, request)))))))),
    ]);
    const details = plan.map(({ detail }) => detail);

    assert.match(compiled.sql, /from "session_message" where "time_created" >= \?/u);
    assert.doesNotMatch(compiled.sql, /cotail_validated_message|cotail_validate_message|cotail_document|json_/u);
    assert.equal(details.some((detail) => /SCAN session_message/u.test(detail)), false, details.join("\n"));
    assert.equal(details.some((detail) => /SEARCH session_message .*time_created/u.test(detail)), true,
      details.join("\n"));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("validates bounded ranges and positive finite limits", () => {
  const query = {} as LogicalQueryShape;
  const invalid: readonly RecentMessageActivityRequest[] = [
    { messageCreatedRange: {}, limit: 1 },
    { messageCreatedRange: { from: 1, to: 1 }, limit: 1 },
    { messageCreatedRange: { from: Number.NaN }, limit: 1 },
    { messageCreatedRange: { from: 1 }, limit: 0 },
    { messageCreatedRange: { from: 1 }, limit: 1.5 },
  ];
  for (const request of invalid) {
    assert.throws(() => readRecentMessageActivity(query, request));
  }
});
