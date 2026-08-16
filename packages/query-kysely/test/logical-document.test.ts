import assert from "node:assert/strict";
import test from "node:test";
import { Kysely, SqliteDialect } from "kysely";
import { logicalWorld } from "../src/relations/world.ts";
import { ReadonlyNodeSqliteDatabase } from "../src/runtime/node-sqlite.ts";
import type { PhysicalOpenCodeV2 } from "../src/source/contracts.ts";
import { openCodeV2Fixture } from "./fixtures/opencode-v2.ts";

function documentFixture() {
  const fixture = openCodeV2Fixture();
  fixture.database.exec(`
    insert into session_v2 (
      id, project_id, workspace_id, slug, directory, path, title, version, metadata, agent, model,
      cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      time_created, time_updated
    ) values (
      'ses_docs', 'prj_docs', 'wsp_docs', 'docs', '/work/docs', 'packages/query-kysely', 'Document session', '2',
      '{"opaqueSession":"SESSION_SECRET"}', 'structured-agent', 'structured-model',
      0, 0, 0, 0, 0, 0, 1, 999
    );
  `);
  const insert = fixture.database.prepare(
    "insert into session_message values (?, 'ses_docs', ?, ?, ?, ?, ?)",
  );
  const message = (id: string, type: string, seq: number, data: Record<string, unknown>) =>
    insert.run(id, type, seq, seq * 10, seq * 10 + 7,
      JSON.stringify({ ...data, time: data.time ?? { created: seq * 10 } }));

  message("msg_agent", "agent-switched", 1, { agent: "switch-only-agent" });
  message("msg_model", "model-switched", 2, {
    model: { id: "switch-only-model", providerID: "switch-only-provider" },
    previous: { id: "previous-only-model", providerID: "previous-only-provider" },
  });
  message("msg_user", "user", 3, {
    text: "user prompt",
    files: [{
      data: "QkFTRTY0X1NFQ1JFVA==", mime: "text/plain",
      source: { type: "uri", uri: "file:///input.txt" },
      name: "input.txt", description: "input description",
    }],
    agents: [{ name: "attachment agent" }],
    skills: [{ id: "skill-id", name: "attachment skill", text: "attachment skill text" }],
    metadata: { opaqueUser: "USER_SECRET" },
  });
  message("msg_synthetic", "synthetic", 4, { text: "synthetic text", description: "not indexed" });
  message("msg_system", "system", 5, { text: "system text" });
  message("msg_skill", "skill", 6, { skill: "skill-loaded", name: "Loaded", text: "skill text" });
  message("msg_assistant", "assistant", 7, {
    agent: "build", model: { id: "gpt", providerID: "provider" },
    content: [
      { type: "text", text: "assistant text", state: { opaque: "PROVIDER_SECRET" } },
      { type: "reasoning", text: "assistant reasoning" },
      {
        type: "tool", id: "call-ok", name: "read", providerState: { opaque: "TOOL_PROVIDER_SECRET" },
        state: {
          status: "completed", input: { z: 1, path: "/tmp/a" }, metadata: { opaque: "TOOL_METADATA_SECRET" },
          content: [
            { type: "text", text: "tool output" },
            { type: "file", uri: "file:///result.txt", mime: "text/plain", name: "result.txt" },
          ],
        },
        time: { created: 71, completed: 72 },
      },
      {
        type: "tool", id: "call-error", name: "write",
        state: {
          status: "error", input: { path: "/denied" },
          error: { type: "permission", message: "tool denied" },
          content: [{ type: "text", text: "partial tool output" }],
        },
        time: { created: 73, completed: 74 },
      },
      {
        type: "tool", id: "call-stream", name: "grep",
        state: { status: "streaming", input: "{\"unfinished\":" }, time: { created: 75 },
      },
    ],
    metadata: { opaqueAssistant: "ASSISTANT_SECRET" }, time: { created: 70, completed: 79 },
  });
  message("msg_shell", "shell", 8, {
    shellID: "sh_docs", command: "printf shell", status: "exited", exit: 0,
    output: { output: "shell output", cursor: 12, size: 12, truncated: false },
    metadata: { opaqueShell: "SHELL_SECRET" }, time: { created: 80, completed: 81 },
  });
  message("msg_compaction", "compaction", 9, {
    status: "completed", reason: "manual", summary: "compact summary", recent: "compact recent",
    metadata: { opaqueCompaction: "COMPACTION_SECRET" },
  });
  message("msg_compaction_error", "compaction", 10, {
    status: "failed", reason: "auto", error: { type: "compact", message: "compact error" },
  });
  const adapter = new ReadonlyNodeSqliteDatabase(fixture.database);
  const physical = new Kysely<PhysicalOpenCodeV2>({ dialect: new SqliteDialect({ database: adapter }) });
  return { adapter, db: logicalWorld(physical) };
}

test("normalizes every supported searchable V2 semantic family", async () => {
  const { adapter, db } = documentFixture();
  try {
    const documents = await db.selectFrom("cotail_document").selectAll()
      .orderBy("messageSeq").orderBy("fieldOrder").orderBy("documentKey").execute();
    const values = documents.map(({ field, text }) => [field, text]);

    assert.deepEqual(values.filter(([field]) => field === "session.title" || field === "session.location"), [
      ["session.title", "Document session"], ["session.location", "/work/docs"],
      ["session.location", "packages/query-kysely"],
    ]);
    for (const expected of [
      ["user.text", "user prompt"], ["synthetic.text", "synthetic text"],
      ["system.text", "system text"], ["skill.text", "skill text"],
      ["assistant.text", "assistant text"], ["assistant.reasoning", "assistant reasoning"],
      ["tool.name", "read"], ["tool.output", "tool output"], ["tool.output", "result.txt"],
      ["tool.output", "file:///result.txt"], ["tool.output", "text/plain"],
      ["tool.error", "tool denied"], ["shell.command", "printf shell"],
      ["shell.output", "shell output"], ["attachment.name", "input.txt"],
      ["attachment.description", "input description"], ["attachment.uri", "file:///input.txt"],
      ["attachment.name", "attachment agent"], ["attachment.name", "attachment skill"],
      ["skill.text", "attachment skill text"], ["compaction.summary", "compact summary"],
      ["compaction.recent", "compact recent"], ["compaction.error", "compact error"],
    ]) assert.ok(values.some((value) => value[0] === expected[0] && value[1] === expected[1]), expected.join(":"));

    const structuredInput = documents.find((row) => row.nativeID === "call-ok" && row.field === "tool.input");
    assert.equal(structuredInput?.text, '{"z":1,"path":"/tmp/a"}');
    const streamingInput = documents.find((row) => row.nativeID === "call-stream" && row.field === "tool.input");
    assert.equal(streamingInput?.text, '{"unfinished":');

    const reasoning = documents.find((row) => row.field === "assistant.reasoning");
    assert.equal(reasoning?.exposure, "reasoning");
    assert.equal(documents.find((row) => row.field === "system.text")?.exposure, "system");
    assert.equal(documents.find((row) => row.field === "tool.name")?.exposure, "tool");
    assert.equal(documents.find((row) => row.field === "shell.command")?.exposure, "shell");
    assert.equal(documents.find((row) => row.field === "attachment.uri")?.exposure, "sensitive-metadata");
  } finally {
    adapter.close();
  }
});

test("preserves exact owner provenance, revision, deterministic keys, and ordering", async () => {
  const { adapter, db } = documentFixture();
  try {
    const query = db.selectFrom("cotail_document").selectAll()
      .where("messageID", "is not", null)
      .orderBy("messageSeq").orderBy("fieldOrder").orderBy("documentKey");
    const first = await query.execute();
    const second = await query.execute();
    assert.deepEqual(second, first);
    assert.equal(new Set(first.map((row) => row.documentKey)).size, first.length);

    const toolFileName = first.find((row) => row.text === "result.txt");
    assert.deepEqual(toolFileName && {
      ownerKind: toolFileName.ownerKind, sessionID: toolFileName.sessionID,
      projectID: toolFileName.projectID, workspaceID: toolFileName.workspaceID,
      messageID: toolFileName.messageID, contentIndex: toolFileName.contentIndex,
      nestedIndex: toolFileName.nestedIndex, nativeID: toolFileName.nativeID,
      messageSeq: toolFileName.messageSeq, messageUpdatedAt: toolFileName.messageUpdatedAt,
      fieldOrder: toolFileName.fieldOrder,
    }, {
      ownerKind: "tool-result", sessionID: "ses_docs", projectID: null, workspaceID: null,
      messageID: "msg_assistant", contentIndex: 2, nestedIndex: 1, nativeID: "call-ok",
      messageSeq: 7, messageUpdatedAt: 77, fieldOrder: 215,
    });
    assert.equal(toolFileName?.documentKey,
      '["tool-result","ses_docs","msg_assistant",2,"call-ok",1,"tool.output",1]');

    const orderedAssistant = first.filter((row) => row.messageID === "msg_assistant")
      .map((row) => [row.fieldOrder, row.field, row.text]);
    assert.deepEqual(orderedAssistant, [...orderedAssistant].sort((left, right) =>
      Number(left[0]) - Number(right[0]) || String(left[1]).localeCompare(String(right[1]))));
  } finally {
    adapter.close();
  }
});

test("does not invent switch documents or leak Base64 and opaque metadata", async () => {
  const { adapter, db } = documentFixture();
  try {
    const documents = await db.selectFrom("cotail_document").selectAll().execute();
    const searchable = documents.map((row) => row.text).join("\n");
    for (const excluded of [
      "switch-only-agent", "switch-only-model", "switch-only-provider", "previous-only-model",
      "QkFTRTY0X1NFQ1JFVA==", "SESSION_SECRET", "USER_SECRET", "PROVIDER_SECRET",
      "TOOL_PROVIDER_SECRET", "TOOL_METADATA_SECRET", "SHELL_SECRET", "COMPACTION_SECRET",
    ]) assert.equal(searchable.includes(excluded), false, excluded);
    assert.equal(documents.some((row) => row.messageID === "msg_agent" || row.messageID === "msg_model"), false);
  } finally {
    adapter.close();
  }
});
