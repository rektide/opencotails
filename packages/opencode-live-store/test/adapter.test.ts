import assert from "node:assert/strict";
import { mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Kysely, SqliteDialect, sql } from "kysely";
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
    insert into session values ('newer', 'p2', 's', 'newer', '/work', 'newer', '2', 2, 4);
    insert into session values ('other', 'p2', null, 'other', '/other', 'other', '2', 3, 3);
    insert into message values ('m-s', 's', 1, '{"role":"user"}');
    insert into message values ('m-newer-a', 'newer', 2, '{"role":"user"}');
    insert into message values ('m-newer-b', 'newer', 3, '{"role":"assistant"}');
    insert into message values ('m-other', 'other', 3, '{"role":"user"}');
    insert into part values ('p-s', 'm-s', 's', 1, '{"type":"text","text":"alpha beta"}');
    insert into part values ('p-newer-a', 'm-newer-a', 'newer', 2, '{"type":"text","text":"alpha only"}');
    insert into part values ('p-newer-b', 'm-newer-b', 'newer', 3, '{"type":"text","text":"beta only"}');
    insert into part values ('p-other', 'm-other', 'other', 3, '{"type":"text","text":"alpha blocked"}');
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
  const statement = new NodeSqliteStatement(native.prepare("create table forbidden (id text)"), "create table forbidden (id text)");
  assert.throws(() => statement.run([]), /read-only adapter cannot run writes/);
  native.close();
});

test("Kysely write dispatch reaches the select-only rejection", async () => {
  const native = new DatabaseSync(":memory:");
  const database = new Kysely<Record<string, never>>({
    dialect: new SqliteDialect({ database: new NodeSqliteDatabase(native) }),
  });
  await assert.rejects(sql`create table forbidden (id text)`.execute(database), /read-only adapter cannot run writes/);
  assert.equal(native.prepare("select count(*) as count from sqlite_master where name = 'forbidden'").get()!.count, 0);
  await database.destroy();
});

test("data-changing CTEs do not bypass the select-only rejection", () => {
  const native = new DatabaseSync(":memory:");
  native.exec("create table item (id text)");
  const statement = "with chosen as (select 'x' as id) insert into item select id from chosen returning id";
  const prepared = new NodeSqliteStatement(native.prepare(statement), statement);
  assert.throws(() => prepared.all([]), /read-only adapter cannot run writes/);
  assert.equal(native.prepare("select count(*) as count from item").get()!.count, 0);
  native.close();
});

test("capabilities reject missing tables and columns", () => {
  const missing = new DatabaseSync(":memory:");
  assert.throws(() => detectCapabilities(missing), /no complete V1 or V2 layout/);
  missing.exec("create table session (id text)");
  assert.throws(() => detectCapabilities(missing), /missing required columns/);
  missing.close();
});

test("capabilities reject partially present owner layouts", () => {
  const malformedV1 = new DatabaseSync(":memory:");
  malformedV1.exec(`
    create table session (id text, project_id text, parent_id text, slug text,
      directory text, title text, version text, time_created integer, time_updated integer);
    create table message (id text, session_id text, time_created integer, data text);
  `);
  assert.throws(() => detectCapabilities(malformedV1), /incomplete V1 layout/);
  malformedV1.close();

  const malformedV2 = new DatabaseSync(":memory:");
  malformedV2.exec(`
    create table session_v2 (id text, project_id text, parent_id text, slug text,
      directory text, title text, version text, time_created integer, time_updated integer);
  `);
  assert.throws(() => detectCapabilities(malformedV2), /incomplete V2 layout/);
  malformedV2.close();
});

test("failed store opens close their native file descriptors", { skip: process.platform !== "linux" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "cotail-invalid-"));
  const path = join(directory, "invalid.db");
  const database = new DatabaseSync(path);
  database.exec("create table session (id text)");
  database.close();
  try {
    const descriptors = () => Array.from({ length: 4096 }, (_, fd) => {
      try { return readlinkSync(`/proc/self/fd/${fd}`); } catch { return undefined; }
    }).filter((target) => target === path).length;
    assert.equal(descriptors(), 0);
    for (let index = 0; index < 20; index++) {
      assert.throws(() => openOpencodeLiveStore(path), /missing required columns/);
    }
    assert.equal(descriptors(), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

test("resolve lowers selectors, ranges, and latest versus only", async () => {
  const { directory, path } = fixture();
  const store = openOpencodeLiveStore(path);
  try {
    assert.equal((await store.resolve({ selector: {}, mode: "latest" }))?.id, "newer");
    assert.equal((await store.resolve({ selector: { ids: ["s"] }, mode: "only" }))?.id, "s");
    assert.equal((await store.resolve({ selector: { projectIds: ["p2"] }, mode: "only" })), undefined);
    assert.equal((await store.resolve({ selector: { directory: { mode: "exact", value: "/work" } }, mode: "latest" }))?.id, "newer");
    assert.equal((await store.resolve({ selector: { directory: { mode: "contains", value: "other" } }, mode: "latest" }))?.id, "other");
    assert.equal((await store.resolve({ selector: { updated: { from: 3, to: 4 } }, mode: "latest" }))?.id, "other");
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("title search executes all, any, none, case, literal, scopes, ordering, and limit", async () => {
  const { directory, path } = fixture();
  const store = openOpencodeLiveStore(path);
  try {
    const base = { selector: {}, requirements: undefined, evidence: false, limit: 10 } as const;
    assert.deepEqual((await store.searchDirect({ ...base, title: { all: [{ source: "title" }] } })).map((hit) => hit.session.id), ["s"]);
    assert.deepEqual((await store.searchDirect({ ...base, title: { any: [{ source: "newer" }, { source: "other" }] } })).map((hit) => hit.session.id), ["newer", "other"]);
    assert.deepEqual((await store.searchDirect({ ...base, title: { all: [{ source: "newer" }], none: [{ source: "other" }] } })).map((hit) => hit.session.id), ["newer"]);
    assert.deepEqual((await store.searchDirect({ ...base, title: { all: [{ source: "NEWER", caseSensitive: true }] } })).map((hit) => hit.session.id), []);
    assert.deepEqual((await store.searchDirect({ ...base, title: { all: [{ source: ".*", mode: "literal" }] } })).map((hit) => hit.session.id), []);
    assert.deepEqual((await store.searchDirect({ ...base, selector: { directory: { mode: "contains", value: "work" }, updated: { from: 2, to: 5 } }, title: { any: [{ source: "." }] }, limit: 1 })).map((hit) => hit.session.id), ["newer"]);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("V1 content search keeps independent requirements and first evidence", async () => {
  const { directory, path } = fixture();
  const store = openOpencodeLiveStore(path);
  try {
    const hits = await store.searchDirect({
      selector: {},
      requirements: { all: ["alpha", "beta"].map((source) => ({ types: ["text"], text: { all: [{ source }] } })) },
      evidence: true,
      limit: 10,
    });
    assert.deepEqual(hits.map((hit) => hit.session.id), ["newer", "s"]);
    assert.deepEqual(hits.map((hit) => hit.evidenceText), ["alpha only", "alpha beta"]);
    const sameWitness = await store.searchDirect({
      selector: {},
      requirements: { all: [{ types: ["text"], text: { all: [{ source: "alpha" }, { source: "beta" }] } }] },
      evidence: false,
      limit: 10,
    });
    assert.deepEqual(sameWitness.map((hit) => hit.session.id), ["s"]);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("content requirements execute mixed all, any, none with positive-only evidence", async () => {
  const { directory, path } = fixture();
  const store = openOpencodeLiveStore(path);
  const requirement = (source: string) => ({ types: ["text"] as const, text: { all: [{ source }] } });
  try {
    const request = {
      selector: {},
      requirements: {
        all: [requirement("alpha")],
        any: [requirement("missing"), requirement("beta")],
        none: [requirement("blocked")],
      },
      evidence: true,
      limit: 10,
    } as const;
    const hits = await store.searchDirect(request);
    assert.deepEqual(hits.map((hit) => hit.session.id), ["newer", "s"]);
    assert.deepEqual(hits.map((hit) => hit.evidenceText), ["alpha only", "alpha beta"]);
    const withoutEvidence = await store.searchDirect({ ...request, evidence: false });
    assert.deepEqual(withoutEvidence.map((hit) => hit.session.id), hits.map((hit) => hit.session.id));
    assert(withoutEvidence.every((hit) => hit.evidenceText === undefined));

    const anyOnly = await store.searchDirect({
      selector: {}, requirements: { any: [requirement("missing"), requirement("alpha")] }, evidence: true, limit: 10,
    });
    assert.deepEqual(anyOnly.map((hit) => hit.session.id), ["newer", "other", "s"]);
    assert.deepEqual(anyOnly.map((hit) => hit.evidenceText), ["alpha only", "alpha blocked", "alpha beta"]);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
