import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sessionGet } from "../src/tools/session-get/index.ts";
import { SessionGetInput, SessionGetSuccess, SessionGetError } from "../src/tools/session-get/contract.ts";
import { createCliDatabase } from "./fixtures/profile/database.ts";
import { writeCliSourceProfile } from "./fixtures/profile/source-profile.ts";

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "cotail-callable-read-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "source.db");
  const profilePath = join(directory, "profile.json");
  await createCliDatabase(databasePath);
  await writeCliSourceProfile(databasePath, profilePath);
  return { directory, databasePath, profilePath };
}

const request = (sessionID = "ses_other_abcdefghijkl") => ({ schema: "cotail.session-get.input/v1", sessionID });

test("shared Session read preserves parent/child report and explicit source provenance", async t => {
  const source = await fixture(t);
  const before = await readFile(source.databasePath);
  for (const id of ["ses_newest_abcdefghijkl", "ses_other_abcdefghijkl"]) {
    const result = await sessionGet(source, request(id));
    assert(result.ok);
    assert(SessionGetSuccess.safeParse(result).success);
    assert.equal(result.identityStatus, "selection-scoped");
    assert.equal(result.observation.target.source.sourceID, "fixture");
    assert.equal(result.observation.target.address.sessionID, id);
    assert(result.observation.read.readScopeID.length > 0);
    assert(result.observation.read.observedAt > 0);
    if (id === "ses_other_abcdefghijkl") assert.equal(result.observation.value.lineage.parentSessionID, "ses_newest_abcdefghijkl");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
  assert.deepEqual(await readFile(source.databasePath), before);
});

test("input cannot select paths, operations or unbounded IDs", async () => {
  for (const input of [null, {}, request(""), request(" "), request("x".repeat(257)), { ...request(), schema: "future" },
    { ...request(), databasePath: "/forbidden" }, { ...request(), profilePath: "/forbidden" }, { ...request(), sql: "select 1" }]) {
    const result = await sessionGet({ profilePath: "/must-not-open" }, input);
    assert(!result.ok);
    assert.equal(result.error.code, "invalid-input");
    assert(SessionGetError.safeParse(result.error).success);
  }
  assert(SessionGetInput.safeParse(request()).success);
});

test("invalid operator budgets fail before source access", async () => {
  for (const source of [{ maxOutputBytes: 4095 }, { maxOutputBytes: 1_048_577 }, { maxOutputBytes: NaN },
    { busyTimeoutMs: -1 }, { busyTimeoutMs: 0.5 }]) {
    const result = await sessionGet({ ...source, profilePath: "/must-not-open" }, request());
    assert(!result.ok && result.error.code === "invalid-configuration");
  }
});

test("expected profile, source and Session failures are plain declared errors", async t => {
  const source = await fixture(t);
  const missing = await sessionGet(source, request("ses_absent"));
  assert(!missing.ok && missing.error.code === "session-not-found");
  const profile = await sessionGet({ profilePath: join(source.directory, "missing.json") }, request());
  assert(!profile.ok && profile.error.code === "source-profile");
  await writeFile(source.profilePath, "{");
  const malformed = await sessionGet(source, request());
  assert(!malformed.ok && malformed.error.code === "source-profile");
  await writeCliSourceProfile(source.databasePath, source.profilePath);
  await rm(source.databasePath);
  const unavailable = await sessionGet(source, request());
  assert(!unavailable.ok && unavailable.error.code === "source-unavailable");
  for (const result of [missing, profile, malformed, unavailable]) assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("stale schema and invalid report fail naturally; malformed Message bodies stay lazy", async t => {
  const source = await fixture(t);
  const db = new DatabaseSync(source.databasePath);
  db.exec("update session_message set data = 'not-json'");
  assert((await sessionGet(source, request())).ok);
  db.exec("update session_v2 set slug = '' where id = 'ses_other_abcdefghijkl'");
  const report = await sessionGet(source, request());
  assert(!report.ok && report.error.code === "invalid-report");
  db.exec("alter table session_v2 rename column title to wrong_title");
  db.close();
  const schema = await sessionGet(source, request());
  assert(!schema.ok && schema.error.code === "query-failed");
});

test("operator output budget rejects oversized data without truncating canonical fields", async t => {
  const source = await fixture(t);
  const db = new DatabaseSync(source.databasePath);
  db.prepare("update session_v2 set title = ? where id = 'ses_other_abcdefghijkl'").run("🙂".repeat(3000));
  db.close();
  const result = await sessionGet({ ...source, maxOutputBytes: 4096 }, request());
  assert(!result.ok && result.error.code === "output-too-large");
  assert(Buffer.byteLength(JSON.stringify(result)) < 4096);
  const allowed = await sessionGet(source, request());
  assert(allowed.ok && allowed.observation.value.title === "🙂".repeat(3000));
});

test("actual acquisition uses query_only, no schema inspection, and closes on cancellation", async t => {
  const source = await fixture(t);
  const executed: string[] = [];
  const prepared: string[] = [];
  const exec = DatabaseSync.prototype.exec;
  const prepare = DatabaseSync.prototype.prepare;
  const close = DatabaseSync.prototype.close;
  let closes = 0;
  t.mock.method(DatabaseSync.prototype, "exec", function(this: DatabaseSync, sql: string) {
    executed.push(sql); return exec.call(this, sql);
  });
  t.mock.method(DatabaseSync.prototype, "prepare", function(this: DatabaseSync, sql: string) {
    prepared.push(sql); return prepare.call(this, sql);
  });
  t.mock.method(DatabaseSync.prototype, "close", function(this: DatabaseSync) { closes++; return close.call(this); });
  assert((await sessionGet(source, request())).ok);
  assert.equal(closes, 1);
  assert.deepEqual(executed, ["PRAGMA query_only = ON", "BEGIN DEFERRED", "ROLLBACK"]);
  assert(prepared.every(sql => !/sqlite_(schema|master)|pragma_(table|index)|migration\.v1-v2|select\s+distinct\s+type/i.test(sql)));
  const controller = new AbortController();
  t.mock.method(DatabaseSync.prototype, "prepare", function(this: DatabaseSync, sql: string) {
    const statement = prepare.call(this, sql); controller.abort(); return statement;
  });
  const cancelled = await sessionGet(source, request(), { signal: controller.signal });
  assert(!cancelled.ok && cancelled.error.code === "cancelled");
  assert.equal(closes, 2);
  const prior = await sessionGet(source, request(), { signal: AbortSignal.abort() });
  assert(!prior.ok && prior.error.code === "cancelled");
  assert.equal(closes, 2);
});
