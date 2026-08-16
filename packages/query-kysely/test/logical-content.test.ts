import assert from "node:assert/strict";
import test from "node:test";
import { Kysely, SqliteDialect } from "kysely";
import { logicalWorld } from "../src/relations/world.ts";
import { ReadonlyNodeSqliteDatabase } from "../src/runtime/node-sqlite.ts";
import type { PhysicalOpenCodeV2 } from "../src/source/contracts.ts";
import { openCodeV2Fixture } from "./fixtures/opencode-v2.ts";

function contentFixture() {
  const fixture = openCodeV2Fixture();
  fixture.database.exec(`
    insert into session_v2 (
      id, project_id, slug, directory, title, version, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
      tokens_cache_write, time_created, time_updated
    ) values ('ses_fixture', 'prj_fixture', 'fixture', '/fixture', 'V2 content', '2',
      0, 0, 0, 0, 0, 0, 1, 100);
  `);
  const insert = fixture.database.prepare(
    "insert into session_message values (?, 'ses_fixture', ?, ?, ?, ?, ?)",
  );
  const message = (id: string, type: string, seq: number, data: unknown) =>
    insert.run(id, type, seq, seq * 10, seq * 10 + 1, JSON.stringify(data));

  message("msg_agent", "agent-switched", 1, { agent: "build", time: { created: 10 } });
  message("msg_model", "model-switched", 3, {
    model: { id: "gpt", providerID: "openai", variant: "high" },
    previous: { id: "sonnet", providerID: "anthropic" }, time: { created: 30 },
  });
  message("msg_user", "user", 8, {
    text: "inspect the fixture",
    files: [{
      data: "aGVsbG8=", mime: "text/plain", source: { type: "uri", uri: "file:///tmp/input.txt" },
      name: "input.txt", description: "fixture input",
      mention: { start: 0, end: 5, text: "input" },
    }],
    agents: [{ name: "review", mention: { start: 6, end: 12, text: "review" } }],
    skills: [{ id: "skill_test", name: "testing", text: "test instructions" }],
    metadata: { client: "fixture" }, time: { created: 80 },
  });
  message("msg_synthetic", "synthetic", 13, {
    text: "synthetic context", description: "generated", time: { created: 130 },
  });
  message("msg_system", "system", 14, { text: "system context", time: { created: 140 } });
  message("msg_skill", "skill", 21, {
    skill: "skill_loaded", name: "loaded skill", text: "loaded instructions", time: { created: 210 },
  });
  message("msg_shell", "shell", 34, {
    shellID: "sh_fixture", command: "printf fixture", status: "exited", exit: 0,
    output: { output: "fixture", cursor: 7, size: 7, truncated: false },
    metadata: { origin: "test" }, time: { created: 340, completed: 345 },
  });
  message("msg_assistant", "assistant", 55, {
    agent: "build", model: { id: "gpt", providerID: "openai", variant: "high" },
    content: [
      { type: "text", text: "answer text", state: { responseID: "response-1" } },
      { type: "reasoning", text: "reasoning text", state: { encrypted: true }, time: { created: 551, completed: 552 } },
      {
        type: "tool", id: "call_completed", name: "read", executed: true,
        providerState: { requestID: "request-1" }, providerResultState: { responseID: "response-2" },
        state: {
          status: "completed", input: { path: "/tmp/input.txt" }, metadata: { bytes: 7 },
          content: [
            { type: "text", text: "tool text" },
            { type: "file", uri: "file:///tmp/output.txt", mime: "text/plain", name: "output.txt" },
          ],
        },
        time: { created: 553, ran: 554, completed: 555 },
      },
      {
        type: "tool", id: "call_error", name: "write",
        state: {
          status: "error", input: { path: "/denied" },
          error: { type: "permission", message: "denied", status: 403 },
          content: [{ type: "text", text: "partial output" }],
        },
        time: { created: 556, completed: 557 },
      },
      {
        type: "tool", id: "call_streaming", name: "grep",
        state: { status: "streaming", input: "{\"pattern\":\"fix" }, time: { created: 558 },
      },
      {
        type: "tool", id: "call_running", name: "shell",
        state: { status: "running", input: { command: "pwd" }, metadata: { pid: 42 } },
        time: { created: 559, ran: 560 },
      },
    ],
    snapshot: { start: "snp_start", end: "snp_end", files: ["src/a.ts"] },
    finish: "stop", cost: 1.25,
    tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 4, write: 5 } },
    error: { type: "provider.warning", message: "recovered", status: 429 },
    retry: { attempt: 2, at: 550, error: { type: "provider.retry", message: "retry" } },
    metadata: { trace: "trace-1" }, time: { created: 550, completed: 561 },
  });
  message("msg_compaction_running", "compaction", 70, {
    status: "running", reason: "auto", summary: "summary running", recent: "recent running",
    metadata: { run: 1 }, time: { created: 700 },
  });
  message("msg_compaction_completed", "compaction", 89, {
    status: "completed", reason: "manual", summary: "summary complete", recent: "recent complete",
    time: { created: 890 },
  });
  message("msg_compaction_failed", "compaction", 90, {
    status: "failed", reason: "auto", error: { type: "compact", message: "too large", status: 500 },
    time: { created: 900 },
  });
  message("msg_bad_shell", "shell", 120, {
    shellID: "sh_bad", command: "bad", status: "exited",
    output: { output: 42, cursor: 1, size: 1, truncated: false }, time: { created: 1200 },
  });

  const adapter = new ReadonlyNodeSqliteDatabase(fixture.database);
  const physical = new Kysely<PhysicalOpenCodeV2>({ dialect: new SqliteDialect({ database: adapter }) });
  return { fixture, adapter, db: logicalWorld(physical) };
}

test("projects every V2 Message variant with source identity and sparse ordering", async () => {
  const { adapter, db } = contentFixture();
  try {
    const messages = await db.selectFrom("cotail_message")
      .select(["messageID", "messageType", "messageSeq", "createdAt", "updatedAt", "sourceJSON"])
      .orderBy("messageSeq").execute();
    assert.deepEqual(messages.map(({ messageID, messageType, messageSeq }) => [messageID, messageType, messageSeq]), [
      ["msg_agent", "agent-switched", 1], ["msg_model", "model-switched", 3], ["msg_user", "user", 8],
      ["msg_synthetic", "synthetic", 13], ["msg_system", "system", 14], ["msg_skill", "skill", 21],
      ["msg_shell", "shell", 34], ["msg_assistant", "assistant", 55],
      ["msg_compaction_running", "compaction", 70], ["msg_compaction_completed", "compaction", 89],
      ["msg_compaction_failed", "compaction", 90], ["msg_bad_shell", "shell", 120],
    ]);
    assert.equal(messages[2]?.createdAt, 80);
    assert.equal(messages[2]?.updatedAt, 81);
    assert.equal(JSON.parse(messages[2]?.sourceJSON ?? "null").files[0].data, "aGVsbG8=");

    const content = await db.selectFrom("cotail_content").selectAll()
      .orderBy("messageSeq").orderBy("contentIndex").execute();
    assert.deepEqual(content.map((row) => [row.messageID, row.contentIndex, row.contentKind, row.text]), [
      ["msg_user", 0, "user", "inspect the fixture"],
      ["msg_synthetic", 0, "synthetic", "synthetic context"],
      ["msg_system", 0, "system", "system context"],
      ["msg_skill", 0, "skill", "loaded instructions"],
      ["msg_assistant", 0, "text", "answer text"],
      ["msg_assistant", 1, "reasoning", "reasoning text"],
    ]);
    assert.equal(content.at(-1)?.createdAt, 551);
    assert.equal(content.at(-1)?.completedAt, 552);
    assert.equal(JSON.parse(content[4]?.providerStateJSON ?? "null").responseID, "response-1");
  } finally {
    adapter.close();
  }
});

test("projects user attachments without exposing Base64 bodies", async () => {
  const { adapter, db } = contentFixture();
  try {
    const user = await db.selectFrom("cotail_user_message").selectAll().executeTakeFirstOrThrow();
    assert.equal(user.messageID, "msg_user");
    assert.equal(user.text, "inspect the fixture");
    assert.deepEqual(JSON.parse(user.metadataJSON ?? "null"), { client: "fixture" });

    const attachments = await db.selectFrom("cotail_attachment").selectAll()
      .orderBy("attachmentIndex").execute();
    assert.deepEqual(attachments.map((row) => [row.attachmentIndex, row.sourceIndex, row.attachmentType, row.name]), [
      [0, 0, "file", "input.txt"], [1, 0, "agent", "review"], [2, 0, "skill", "testing"],
    ]);
    assert.equal(attachments[0]?.uri, "file:///tmp/input.txt");
    assert.equal(attachments[0]?.mime, "text/plain");
    assert.equal(attachments[0]?.description, "fixture input");
    assert.equal(attachments[0]?.mentionStart, 0);
    assert.equal(attachments[2]?.skillID, "skill_test");
    assert.equal(attachments[2]?.text, "test instructions");
    assert.ok(!Object.keys(attachments[0] ?? {}).includes("data"));
  } finally {
    adapter.close();
  }
});

test("projects assistant metadata, tool states, and nested result identities", async () => {
  const { adapter, db } = contentFixture();
  try {
    const assistant = await db.selectFrom("cotail_assistant_message").selectAll().executeTakeFirstOrThrow();
    assert.equal(assistant.messageID, "msg_assistant");
    assert.deepEqual(
      [assistant.agent, assistant.providerID, assistant.modelID, assistant.modelVariant, assistant.finish, assistant.cost],
      ["build", "openai", "gpt", "high", "stop", 1.25],
    );
    assert.deepEqual([
      assistant.tokensInput, assistant.tokensOutput, assistant.tokensReasoning,
      assistant.tokensCacheRead, assistant.tokensCacheWrite,
    ], [10, 20, 3, 4, 5]);
    assert.deepEqual([assistant.retryAttempt, assistant.retryAt, assistant.snapshotStart, assistant.snapshotEnd],
      [2, 550, "snp_start", "snp_end"]);
    assert.equal(assistant.createdAt, 550);
    assert.equal(assistant.completedAt, 561);

    const calls = await db.selectFrom("cotail_tool_call").selectAll().orderBy("contentIndex").execute();
    assert.deepEqual(calls.map((row) => [row.contentIndex, row.callID, row.state]), [
      [2, "call_completed", "completed"], [3, "call_error", "error"],
      [4, "call_streaming", "streaming"], [5, "call_running", "running"],
    ]);
    assert.deepEqual(JSON.parse(calls[0]?.inputJSON ?? "null"), { path: "/tmp/input.txt" });
    assert.equal(JSON.parse(calls[0]?.providerResultStateJSON ?? "null").responseID, "response-2");
    assert.equal(calls[1]?.errorMessage, "denied");
    assert.equal(JSON.parse(calls[2]?.inputJSON ?? "null"), "{\"pattern\":\"fix");
    assert.deepEqual(JSON.parse(calls[3]?.metadataJSON ?? "null"), { pid: 42 });

    const results = await db.selectFrom("cotail_tool_result").selectAll()
      .orderBy("contentIndex").orderBy("resultIndex").execute();
    assert.deepEqual(results.map((row) => [row.contentIndex, row.callID, row.resultIndex, row.resultKind]), [
      [2, "call_completed", 0, "text"], [2, "call_completed", 1, "file"],
      [3, "call_error", 0, "text"],
    ]);
    assert.equal(results[0]?.text, "tool text");
    assert.deepEqual([results[1]?.uri, results[1]?.mime, results[1]?.name],
      ["file:///tmp/output.txt", "text/plain", "output.txt"]);
  } finally {
    adapter.close();
  }
});

test("projects shell and compaction fields and suppresses malformed semantic rows", async () => {
  const { adapter, db } = contentFixture();
  try {
    const shells = await db.selectFrom("cotail_shell_execution").selectAll().execute();
    assert.equal(shells.length, 1);
    assert.deepEqual(
      [shells[0]?.messageID, shells[0]?.shellID, shells[0]?.command, shells[0]?.status, shells[0]?.exit],
      ["msg_shell", "sh_fixture", "printf fixture", "exited", 0],
    );
    assert.deepEqual(
      [shells[0]?.output, shells[0]?.outputCursor, shells[0]?.outputSize, shells[0]?.outputTruncated],
      ["fixture", 7, 7, 0],
    );
    assert.deepEqual(JSON.parse(shells[0]?.metadataJSON ?? "null"), { origin: "test" });

    const compactions = await db.selectFrom("cotail_compaction").selectAll().orderBy("messageSeq").execute();
    assert.deepEqual(compactions.map((row) => [row.messageID, row.status, row.reason]), [
      ["msg_compaction_running", "running", "auto"],
      ["msg_compaction_completed", "completed", "manual"],
      ["msg_compaction_failed", "failed", "auto"],
    ]);
    assert.equal(compactions[0]?.summary, "summary running");
    assert.equal(compactions[1]?.recent, "recent complete");
    assert.equal(compactions[2]?.errorMessage, "too large");

    const malformedBase = await db.selectFrom("cotail_message").select("messageID")
      .where("messageID", "=", "msg_bad_shell").executeTakeFirst();
    assert.equal(malformedBase?.messageID, "msg_bad_shell");
    assert.equal(shells.some((row) => row.messageID === "msg_bad_shell"), false);
  } finally {
    adapter.close();
  }
});
