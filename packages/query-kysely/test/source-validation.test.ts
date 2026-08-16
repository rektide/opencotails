import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Cause, Effect, Exit } from "effect";
import {
  CURRENT_MESSAGE_VARIANTS,
  IncompleteContentModelError,
  MigrationIncompleteError,
  SourceSchemaError,
  inspectOpenCodeV2Source,
} from "../src/source/index.ts";
import { openCodeV2Fixture, validMessageData } from "./fixtures/opencode-v2.ts";

const inspect = (database: DatabaseSync) => Effect.runSync(inspectOpenCodeV2Source(database));

function failure(database: DatabaseSync) {
  const exit = Effect.runSyncExit(inspectOpenCodeV2Source(database));
  assert(Exit.isFailure(exit));
  return Cause.squash(exit.cause);
}

test("accepts the authoritative V2 projection and reports schema capabilities", () => {
  const fixture = openCodeV2Fixture({ pendingInput: true });
  try {
    for (const type of CURRENT_MESSAGE_VARIANTS) fixture.addMessage(type);
    const capabilities = inspect(fixture.database);
    assert.equal(capabilities._tag, "OpenCodeV2SourceCapabilities");
    assert.equal(capabilities.projectedSessions, true);
    assert.equal(capabilities.projectedMessages, true);
    assert.equal(capabilities.pendingInput, true);
    assert.equal(capabilities.eventRows, "unavailable");
    assert.deepEqual([...capabilities.contentModel].sort(), [...CURRENT_MESSAGE_VARIANTS].sort());
  } finally {
    fixture.database.close();
  }
});

test("accepts schema-valid nested attachments, tool states, shell output, and compaction variants", () => {
  const fixture = openCodeV2Fixture();
  try {
    fixture.addMessage("user", {
      ...validMessageData("user", "msg_user"),
      files: [{ data: "aGk=", mime: "text/plain", source: { type: "uri", uri: "file:///input" } }],
      agents: [{ name: "review", mention: { start: 0, end: 1, text: "r" } }],
      skills: [{ id: "skill", name: "skill", text: "instructions" }],
    }, "msg_user");
    fixture.addMessage("shell", {
      ...validMessageData("shell", "msg_shell"),
      output: { output: "ok", cursor: 2, size: 2, truncated: false },
      time: { created: 1, completed: 2 },
    }, "msg_shell");
    fixture.addMessage("assistant", {
      ...validMessageData("assistant", "msg_assistant"),
      content: [
        { type: "text", text: "answer" },
        { type: "reasoning", text: "thought", time: { created: 1, completed: 2 } },
        { type: "tool", id: "stream", name: "read", state: { status: "streaming", input: "{" }, time: { created: 1 } },
        { type: "tool", id: "run", name: "read", state: { status: "running", input: {}, metadata: {} }, time: { created: 1 } },
        { type: "tool", id: "done", name: "read", state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] }, time: { created: 1 } },
        { type: "tool", id: "fail", name: "read", state: { status: "error", input: {}, error: { type: "tool", message: "failed" }, content: [{ type: "file", uri: "file:///partial", mime: "text/plain" }] }, time: { created: 1 } },
      ],
    }, "msg_assistant");
    fixture.addMessage("compaction", {
      ...validMessageData("compaction", "msg_compact_running"), status: "running",
    }, "msg_compact_running");
    fixture.addMessage("compaction", {
      ...validMessageData("compaction", "msg_compact_failed"), status: "failed",
      error: { type: "compact", message: "failed" }, summary: undefined, recent: undefined,
    }, "msg_compact_failed");
    assert.doesNotThrow(() => inspect(fixture.database));
  } finally {
    fixture.database.close();
  }
});

test("rejects a complete V1-only database explicitly", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("create table session (id text); create table message (id text); create table part (id text)");
  try {
    const error = failure(database);
    assert(error instanceof SourceSchemaError);
    assert.equal(error.reason, "v1-only");
  } finally {
    database.close();
  }
});

test("requires every current authoritative column", () => {
  const fixture = openCodeV2Fixture();
  try {
    fixture.database.exec("alter table session_message drop column time_updated");
    const error = failure(fixture.database);
    assert(error instanceof SourceSchemaError);
    assert.equal(error.reason, "missing-columns");
    assert.equal(error.table, "session_message");
    assert.deepEqual(error.missingColumns, ["time_updated"]);
  } finally {
    fixture.database.close();
  }
});

test("requires a completed migration marker only when legacy session rows remain", () => {
  const emptyResidue = openCodeV2Fixture();
  const legacyRows = openCodeV2Fixture();
  try {
    emptyResidue.database.exec("create table session (id text); create table message (garbage text); create table part (garbage text)");
    assert.doesNotThrow(() => inspect(emptyResidue.database));

    legacyRows.addLegacySession();
    let error = failure(legacyRows.database);
    assert(error instanceof MigrationIncompleteError);
    assert.equal(error.legacySessionCount, 1);
    assert.equal(error.observedPhase, null);

    legacyRows.database.prepare("insert into kv values ('migration.v1-v2', ?, 1, 1)")
      .run(JSON.stringify({ phase: "sessions" }));
    error = failure(legacyRows.database);
    assert(error instanceof MigrationIncompleteError);
    assert.equal(error.observedPhase, "sessions");

    legacyRows.completeMigration();
    assert.doesNotThrow(() => inspect(legacyRows.database));
  } finally {
    emptyResidue.database.close();
    legacyRows.database.close();
  }
});

test("ignores preserved V1 message and part residue after migration", () => {
  const fixture = openCodeV2Fixture();
  try {
    fixture.addLegacySession();
    fixture.database.exec("create table message (unexpected blob); create table part (also_unexpected blob)");
    fixture.database.exec("insert into message values (x'00'); insert into part values (x'01')");
    fixture.completeMigration();
    assert.doesNotThrow(() => inspect(fixture.database));
  } finally {
    fixture.database.close();
  }
});

test("rejects unknown Message variants and malformed Message JSON", () => {
  const unknown = openCodeV2Fixture();
  const malformed = openCodeV2Fixture();
  try {
    unknown.addMessage("future-message");
    const unknownError = failure(unknown.database);
    assert(unknownError instanceof IncompleteContentModelError);
    assert.deepEqual(unknownError.variants, ["future-message"]);

    malformed.addMessage("user", "not-json");
    const malformedError = failure(malformed.database);
    assert(malformedError instanceof SourceSchemaError);
    assert.equal(malformedError.reason, "malformed-message-data");
    assert.equal(malformedError.messageType, "user");
    assert.equal(malformedError.path, "$");
  } finally {
    unknown.database.close();
    malformed.database.close();
  }
});

test("rejects malformed known payloads with message identity and precise nested paths", () => {
  const cases = [
    ["user", { ...validMessageData("user", "msg_bad"), files: [{ data: "%%%", mime: "text/plain", source: { type: "inline" } }] }, "$.files[0].data"],
    ["shell", { ...validMessageData("shell", "msg_bad"), output: { output: 42, cursor: 0, size: 0, truncated: false } }, "$.output.output"],
    ["assistant", {
      ...validMessageData("assistant", "msg_bad"),
      content: [{
        type: "tool", id: "call", name: "read", time: { created: 1 },
        state: { status: "completed", input: {}, content: [{ type: "file", uri: "file:///x" }] },
      }],
    }, "$.content[0].state.content[0].mime"],
    ["compaction", { ...validMessageData("compaction", "msg_bad"), status: "failed", error: { type: "compact" } }, "$.error.message"],
  ] as const;

  for (const [type, data, path] of cases) {
    const fixture = openCodeV2Fixture();
    try {
      fixture.addMessage(type, data, "msg_bad");
      const error = failure(fixture.database);
      assert(error instanceof SourceSchemaError);
      assert.equal(error.reason, "malformed-message-payload");
      assert.equal(error.messageID, "msg_bad");
      assert.equal(error.messageType, type);
      assert.equal(error.path, path);
    } finally {
      fixture.database.close();
    }
  }
});

test("rejects mismatched required root identity before publishing a source", () => {
  const fixture = openCodeV2Fixture();
  try {
    fixture.addMessage("system", { id: "msg_other", type: "system", text: "hidden", time: { created: 1 } }, "msg_row");
    const error = failure(fixture.database);
    assert(error instanceof SourceSchemaError);
    assert.equal(error.reason, "malformed-message-payload");
    assert.equal(error.messageID, "msg_row");
    assert.equal(error.messageType, "system");
    assert.equal(error.path, "$.id");
  } finally {
    fixture.database.close();
  }
});

test("event table existence and watermarks do not claim payload persistence", () => {
  const fixture = openCodeV2Fixture();
  const absent = openCodeV2Fixture({ events: false });
  try {
    fixture.database.prepare("insert into event_sequence values ('ses_fixture', 42, null)").run();
    assert.equal(inspect(fixture.database).eventRows, "unavailable");
    assert.equal(inspect(absent.database).eventRows, "unavailable");

    fixture.addEvent();
    assert.equal(inspect(fixture.database).eventRows, "observed");
  } finally {
    fixture.database.close();
    absent.database.close();
  }
});

test("rejects a partial optional event layout", () => {
  const fixture = openCodeV2Fixture();
  try {
    fixture.database.exec("drop table event");
    const error = failure(fixture.database);
    assert(error instanceof SourceSchemaError);
    assert.equal(error.reason, "incomplete-optional-layout");
  } finally {
    fixture.database.close();
  }
});
