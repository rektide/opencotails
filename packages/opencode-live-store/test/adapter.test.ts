import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openOpencodeLiveStore } from "../src/index.ts";
import { NodeSqliteDatabase, NodeSqliteStatement } from "../src/runtime/node-sqlite.ts";
import { detectCapabilities } from "../src/schema/capabilities.ts";

function fixture(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "cotail-adapter-"));
  const path = join(directory, "fixture.db");
  const database = new DatabaseSync(path);
  database.exec(`
    create table session (id text, project_id text, parent_id text, slug text,
      directory text, title text, version text, time_created integer, time_updated integer);
    create table message (id text, session_id text, time_created integer, data text);
    create table part (id text, message_id text, session_id text, time_created integer, data text);
    insert into session values ('s', 'p', null, 'slug', '/work', 'title', '1', 1, 2);
  `);
  database.close();
  return { directory, path };
}

test("adapter reads a read-only file through all and iterate and rejects run", () => {
  const { directory, path } = fixture();
  try {
    const native = new DatabaseSync(path, { readOnly: true });
    const adapter = new NodeSqliteDatabase(native);
    const statement = adapter.prepare("select id from session where id = ?");
    assert.deepEqual(statement.all(["s"]).map((row) => (row as { id: string }).id), ["s"]);
    assert.deepEqual([...statement.iterate(["s"])].map((row) => (row as { id: string }).id), ["s"]);
    assert.throws(() => statement.run(["s"]), /read-only adapter cannot run writes/);
    adapter.close();
    adapter.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("forced write reaches the select-only statement rejection", () => {
  const native = new DatabaseSync(":memory:");
  const statement = new NodeSqliteStatement(native.prepare("create table forbidden (id text)"));
  assert.throws(() => statement.run([]), /read-only adapter cannot run writes/);
  native.close();
});

test("capabilities reject missing tables and columns", () => {
  const missing = new DatabaseSync(":memory:");
  assert.throws(() => detectCapabilities(missing), /missing session table/);
  missing.exec("create table session (id text)");
  assert.throws(() => detectCapabilities(missing), /missing required columns/);
  missing.close();
});

test("store close is idempotent and operations after close fail", async () => {
  const { directory, path } = fixture();
  try {
    const store = openOpencodeLiveStore(path);
    await store.close();
    await store.close();
    await assert.rejects(store.resolve({ selector: {}, mode: "latest" }), /store closed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
