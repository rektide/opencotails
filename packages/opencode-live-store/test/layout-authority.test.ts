import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openOpencodeLiveStore } from "../src/index.ts";

const SESSION_COLUMNS = `id text, project_id text, parent_id text, slug text,
  directory text, title text, version text, time_created integer, time_updated integer`;

function fixture(layout: "v1" | "v2" | "mixed", phase: string | undefined = "completed") {
  const directory = mkdtempSync(join(tmpdir(), "cotail-layout-"));
  const path = join(directory, "fixture.db");
  const db = new DatabaseSync(path);
  if (layout !== "v2") db.exec(`
    create table session (${SESSION_COLUMNS});
    create table message (id text, session_id text, time_created integer, data text);
    create table part (id text, message_id text, session_id text, time_created integer, data text);
  `);
  if (layout !== "v1") db.exec(`
    create table session_v2 (${SESSION_COLUMNS});
    create table session_message (id text, session_id text, type text, seq integer, time_created integer, data text);
  `);
  if (layout === "mixed" && phase !== undefined) {
    db.exec("create table kv (key text, value text)");
    db.prepare("insert into kv values ('migration.v1-v2', ?)").run(JSON.stringify({ phase }));
  }
  const close = () => rmSync(directory, { recursive: true, force: true });
  return { db, path, close };
}

function session(db: DatabaseSync, table: "session" | "session_v2", id: string, updated: number, title = id) {
  db.prepare(`insert into ${table} values (?, 'project', null, ?, '/work', ?, '1', ?, ?)`)
    .run(id, id, title, updated - 10, updated);
}

function v1Message(db: DatabaseSync, sessionId: string, id: string, time: number, text?: string, type = "text") {
  db.prepare("insert into message values (?, ?, ?, ?)").run(id, sessionId, time, JSON.stringify({ role: "user" }));
  if (text !== undefined) db.prepare("insert into part values (?, ?, ?, ?, ?)")
    .run(`part-${id}`, id, sessionId, time, JSON.stringify({ type, text }));
}

function v2Message(db: DatabaseSync, sessionId: string, id: string, type: string, seq: number, time: number, data: object) {
  db.prepare("insert into session_message values (?, ?, ?, ?, ?, ?)")
    .run(id, sessionId, type, seq, time, JSON.stringify(data));
}

const request = (source: string, type: "text" | "reasoning" | "tool" | "shell" = "text") => ({
  selector: {}, requirements: { all: [{ types: [type], text: { all: [{ source }] } }] }, evidence: true, limit: 100,
} as const);

test("pure V1 uses legacy metadata, content, and canonical message counts", async () => {
  const f = fixture("v1");
  session(f.db, "session", "v1", 100);
  v1Message(f.db, "v1", "m1", 50, "legacy alpha");
  v1Message(f.db, "v1", "m2", 90, "legacy beta");
  f.db.close();
  const store = openOpencodeLiveStore(f.path);
  try {
    assert.deepEqual((await store.searchDirect(request("legacy"))).map((hit) => hit.session.id), ["v1"]);
    assert.deepEqual(await store.history({ selector: { updated: { from: 0 } }, countSince: 80, limit: 0 }), [{
      id: "v1", title: "v1", directory: "/work", slug: "v1", projectId: "project", parentId: null,
      version: "1", timeCreated: 90, timeUpdated: 100, messagesTotal: 2, messagesRecent: 1,
    }]);
  } finally { await store.close(); f.close(); }
});

test("pure V2 uses native metadata, user text, assistant arrays, sequence order, and all-row counts", async () => {
  const f = fixture("v2");
  session(f.db, "session_v2", "v2", 200, "native title");
  v2Message(f.db, "v2", "user", "user", 7, 100, { text: "joined one\n\njoined two" });
  v2Message(f.db, "v2", "assistant", "assistant", 11, 150, { content: [
    { type: "reasoning", text: "first evidence" }, { type: "text", text: "second evidence" },
  ] });
  v2Message(f.db, "v2", "control", "model-switched", 20, 190, {});
  f.db.close();
  const store = openOpencodeLiveStore(f.path);
  try {
    assert.equal((await store.resolve({ selector: {}, mode: "latest" }))?.title, "native title");
    assert.equal((await store.searchDirect(request("joined two")))[0]?.evidenceText, "joined one\n\njoined two");
    assert.equal((await store.searchDirect(request("evidence", "reasoning")))[0]?.evidenceText, "first evidence");
    assert.equal((await store.searchDirect(request("evidence")))[0]?.evidenceText, "second evidence");
    assert.deepEqual((await store.history({ selector: {}, countSince: 120, limit: 0 }))[0], {
      id: "v2", title: "native title", directory: "/work", slug: "v2", projectId: "project", parentId: null,
      version: "1", timeCreated: 190, timeUpdated: 200, messagesTotal: 3, messagesRecent: 2,
    });
    await assert.rejects(store.searchDirect(request("x", "tool")), /V2 tool content search is unsupported/);
    await assert.rejects(store.searchDirect(request("x", "shell")), /shell content search is unsupported/);
  } finally { await store.close(); f.close(); }
});

test("completed mixed ownership excludes overlap, residue, omissions, reverts, and zero-row fallback", async () => {
  const f = fixture("mixed");
  const nativeOwners = ["overlap", "extension", "residue", "both-unique", "zero", "compaction", "subtask", "revert", "sequence"];
  for (const [index, id] of nativeOwners.entries()) {
    session(f.db, "session", id, 100 + index);
    session(f.db, "session_v2", id, 200 + index, `native-${id}`);
  }
  session(f.db, "session_v2", "native-only", 300);
  session(f.db, "session", "v1-only", 150);

  v1Message(f.db, "overlap", "same", 10, "legacy overlap leak");
  v2Message(f.db, "overlap", "same", "user", 0, 10, { text: "native overlap" });
  v1Message(f.db, "extension", "extension-shared", 10, "legacy shared leak");
  v2Message(f.db, "extension", "extension-shared", "user", 0, 10, { text: "native shared" });
  v2Message(f.db, "extension", "extension-extra", "user", 1, 20, { text: "native extension" });
  v1Message(f.db, "residue", "residue-old", 10, "legacy residue leak");
  v2Message(f.db, "residue", "residue-kept", "user", 2, 20, { text: "native residue authority" });
  v1Message(f.db, "both-unique", "only-v1", 10, "legacy unique leak");
  v2Message(f.db, "both-unique", "only-v2", "user", 3, 20, { text: "native unique" });
  v1Message(f.db, "zero", "zero-old", 10, "zero fallback leak");
  v1Message(f.db, "compaction", "compaction-user", 10, "collapsed compaction leak");
  v1Message(f.db, "compaction", "compaction-summary", 11, "collapsed summary leak");
  v2Message(f.db, "compaction", "compaction-user", "compaction", 4, 12, { status: "completed", summary: "not searchable" });
  v1Message(f.db, "subtask", "subtask-user", 10, "omitted subtask leak");
  v1Message(f.db, "subtask", "subtask-assistant", 11, "omitted task assistant leak");
  v1Message(f.db, "revert", "reverted", 30, "reverted legacy leak");
  v2Message(f.db, "revert", "before-revert", "user", 2, 10, { text: "surviving native" });
  v2Message(f.db, "sequence", "gap-a", "assistant", 8, 20, { content: [{ type: "text", text: "gap first" }] });
  v2Message(f.db, "sequence", "gap-b", "assistant", 15, 30, { content: [
    { type: "text", text: "gap second zero" }, { type: "reasoning", text: "gap second one" },
  ] });
  v2Message(f.db, "native-only", "native-message", "user", 12, 250, { text: "native only" });
  v1Message(f.db, "v1-only", "fallback", 140, "legacy fallback");
  f.db.close();

  const store = openOpencodeLiveStore(f.path);
  try {
    assert.equal((await store.resolve({ selector: { ids: ["overlap"] }, mode: "only" }))?.title, "native-overlap");
    for (const leak of ["legacy overlap leak", "legacy shared leak", "legacy residue leak", "legacy unique leak", "zero fallback leak", "collapsed compaction leak", "collapsed summary leak", "omitted subtask leak", "omitted task assistant leak", "reverted legacy leak"]) {
      assert.deepEqual(await store.searchDirect(request(leak)), [], leak);
    }
    for (const visible of ["native overlap", "native extension", "native residue authority", "native unique", "surviving native", "native only", "legacy fallback"]) {
      assert.equal((await store.searchDirect(request(visible))).length, 1, visible);
    }
    assert.equal((await store.searchDirect(request("gap second", "reasoning")))[0]?.evidenceText, "gap second one");
    const history = await store.history({ selector: {}, countSince: 25, limit: 0 });
    const counts = new Map(history.map((row) => [row.id, [row.messagesTotal, row.messagesRecent]]));
    assert.deepEqual(counts.get("zero"), [0, 0]);
    assert.deepEqual(counts.get("compaction"), [1, 0]);
    assert.deepEqual(counts.get("subtask"), [0, 0]);
    assert.deepEqual(counts.get("revert"), [1, 0]);
    assert.deepEqual(counts.get("sequence"), [2, 1]);
    assert.deepEqual(counts.get("v1-only"), [1, 1]);
  } finally { await store.close(); f.close(); }
});

test("partly synthetic migration exposes only canonical user text and omits synthetic rows", async () => {
  const f = fixture("v2");
  session(f.db, "session_v2", "synthetic", 100);
  v2Message(f.db, "synthetic", "ordinary", "user", 1, 10, { text: "ordinary visible" });
  v2Message(f.db, "synthetic", "synthetic-only", "synthetic", 2, 20, { text: "synthetic hidden" });
  f.db.close();
  const store = openOpencodeLiveStore(f.path);
  try {
    assert.equal((await store.searchDirect(request("ordinary visible"))).length, 1);
    assert.deepEqual(await store.searchDirect(request("synthetic hidden")), []);
  } finally { await store.close(); f.close(); }
});

for (const phase of [undefined, "sessions", "running"] as const) {
  test(`mixed database rejects ${phase ?? "absent"} migration marker`, () => {
    const f = fixture("mixed", phase ?? "completed");
    if (phase === undefined) f.db.exec("drop table kv");
    session(f.db, "session", "legacy", 1);
    session(f.db, "session_v2", "legacy", 1);
    f.db.close();
    try { assert.throws(() => openOpencodeLiveStore(f.path), /V1-V2 migration is incomplete/); }
    finally { f.close(); }
  });
}

test("matching message IDs assigned to different sessions reject", () => {
  const f = fixture("mixed");
  session(f.db, "session", "legacy", 1);
  session(f.db, "session_v2", "native", 1);
  v1Message(f.db, "legacy", "collision", 1, "legacy");
  v2Message(f.db, "native", "collision", "user", 1, 1, { text: "native" });
  f.db.close();
  try { assert.throws(() => openOpencodeLiveStore(f.path), /different sessions/); }
  finally { f.close(); }
});

test("duplicate native message IDs reject", () => {
  const f = fixture("v2");
  session(f.db, "session_v2", "native", 1);
  v2Message(f.db, "native", "duplicate", "user", 1, 1, { text: "one" });
  v2Message(f.db, "native", "duplicate", "assistant", 2, 2, { content: [] });
  f.db.close();
  try { assert.throws(() => openOpencodeLiveStore(f.path), /duplicate session_message id/); }
  finally { f.close(); }
});
