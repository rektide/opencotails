import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import {
  createCliDatabase,
  createV1OnlyCliDatabase,
  writeCliSourceProfile,
} from "./fixtures/profile/index.ts";

const directory = mkdtempSync(join(tmpdir(), "cotail-characterization-"));
const database = join(directory, "fixture.db");
await createCliDatabase(database);
const profile = join(directory, "fixture-profile.json");
await writeCliSourceProfile(database, profile);
const v1Database = join(directory, "v1.db");
await createV1OnlyCliDatabase(v1Database);
after(() => rmSync(directory, { recursive: true, force: true }));

function cli(args: readonly string[]) {
  return spawnSync(process.execPath, ["src/cli.ts", ...args, "--profile", profile], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" },
  });
}

test("search title JSONL preserves ordering, scopes, and datetime strings", () => {
  const result = cli(["search", "Alpha", "Beta", "--title-only", "--directory", "/work", "--since", "1970-01-01T00:00:03Z", "--json", "--db", database]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '{"id":"ses_newest_abcdefghijkl","slug":"newest","title":"Alpha Beta","directory":"/work/alpha","created":"1970-01-01 00:00:01","updated":"1970-01-01 00:00:05"}\n');
});

test("content terms use independent witnesses and first-pattern evidence", () => {
  const result = cli(["search", "alpha", "beta", "--json", "--db", database]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{"id":"ses_newest_abcdefghijkl","slug":"newest","title":"Alpha Beta","directory":"/work/alpha","created":"1970-01-01 00:00:01","updated":"1970-01-01 00:00:05","snippet":"alpha beta first snippet"}\n{"id":"ses_split_abcdefghijkl","slug":"split","title":"Split witnesses","directory":"/work/alpha","created":"1970-01-01 00:00:02","updated":"1970-01-01 00:00:04","snippet":"alpha only"}\n{"id":"ses_other_abcdefghijkl","slug":"other","title":"Other","directory":"/work/beta","created":"1970-01-01 00:00:03","updated":"1970-01-01 00:00:03","snippet":"alpha beta other"}\n');
});

test("search --since scopes matching content by Message creation time", () => {
  const result = cli(["search", "alpha", "--since", "1970-01-01T00:00:03Z", "--json", "--db", database]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '{"id":"ses_newest_abcdefghijkl","slug":"newest","title":"Alpha Beta","directory":"/work/alpha","created":"1970-01-01 00:00:01","updated":"1970-01-01 00:00:05","snippet":"alpha beta first snippet"}\n{"id":"ses_other_abcdefghijkl","slug":"other","title":"Other","directory":"/work/beta","created":"1970-01-01 00:00:03","updated":"1970-01-01 00:00:03","snippet":"alpha beta other"}\n');
});

test("content no-snippet, limit zero, fixed strings, and human output remain exact", () => {
  assert.equal(cli(["search", "alpha", "--no-snippet", "--json", "--db", database]).stdout,
    '{"id":"ses_newest_abcdefghijkl","slug":"newest","title":"Alpha Beta","directory":"/work/alpha","created":"1970-01-01 00:00:01","updated":"1970-01-01 00:00:05"}\n{"id":"ses_split_abcdefghijkl","slug":"split","title":"Split witnesses","directory":"/work/alpha","created":"1970-01-01 00:00:02","updated":"1970-01-01 00:00:04"}\n{"id":"ses_other_abcdefghijkl","slug":"other","title":"Other","directory":"/work/beta","created":"1970-01-01 00:00:03","updated":"1970-01-01 00:00:03"}\n');
  assert.equal(cli(["search", "alpha", "--limit", "0", "--db", database]).stdout, "no sessions matched\n");
  assert.equal(cli(["search", "alpha.*beta", "-F", "--json", "--db", database]).stdout, "");
  assert.equal(cli(["search", "alpha", "" + "beta", "--limit", "1", "--db", database]).stdout,
    "ses_newest_a Alpha Beta 1970-01-01 00:00:01 → 1970-01-01 00:00:05\n  newest · /work/alpha\n  alpha beta first snippet\n1 session\n");
});

test("history preserves count policy and all formats", () => {
  const json = cli(["history", "--since", "1970-01-01T00:00:00Z", "--json", "--db", database]);
  assert.equal(json.status, 0);
  assert.equal(json.stdout, '{"id":"ses_newest_abcdefghijkl","title":"Alpha Beta","directory":"/work/alpha","slug":"newest","messages_recent":1,"messages_total":1,"time_created":"1970-01-01T00:00:01.000Z","time_updated":"1970-01-01T00:00:05.000Z"}\n{"id":"ses_split_abcdefghijkl","title":"Split witnesses","directory":"/work/alpha","slug":"split","messages_recent":2,"messages_total":2,"time_created":"1970-01-01T00:00:02.000Z","time_updated":"1970-01-01T00:00:04.000Z"}\n{"id":"ses_other_abcdefghijkl","title":"Other","directory":"/work/beta","slug":"other","messages_recent":1,"messages_total":1,"time_created":"1970-01-01T00:00:03.000Z","time_updated":"1970-01-01T00:00:03.000Z"}\n');
  assert.equal(cli(["history", "--since", "1970-01-01T00:00:00Z", "--limit", "1", "--tsv", "--db", database]).stdout,
    "id\ttitle\tdirectory\tmessages_recent\tmessages_total\ttime_updated\nses_newest_abcdefghijkl\tAlpha Beta\t/work/alpha\t1\t1\t5000\n");
  assert.equal(cli(["history", "--since", "1970-01-01T00:00:00Z", "--limit", "1", "--db", database]).stdout,
    "ID              TITLE       DIRECTORY    RECENT  TOTAL  UPDATED\nses_newest_abc  Alpha Beta  /work/alpha  1       1      1970-01-01 00:00\n1 session active since 1970-01-01 00:00 (cutoff)\n");
});

test("tail emits finite metadata-only activity in stable human and JSONL forms", () => {
  const json = cli(["tail", "--since", "1970-01-01T00:00:03Z", "--limit", "3", "--json", "--db", database]);
  assert.equal(json.status, 0);
  assert.equal(json.stderr, "");
  assert.equal(json.stdout,
    '{"source_id":"fixture","session_id":"ses_newest_abcdefghijkl","message_id":"msg_new","message_type":"assistant","message_seq":0,"time_created":"1970-01-01T00:00:04.500Z","time_updated":"1970-01-01T00:00:04.600Z","session_title":"Alpha Beta","session_directory":"/work/alpha"}\n'
    + '{"source_id":"fixture","session_id":"ses_split_abcdefghijkl","message_id":"msg_split_b","message_type":"user","message_seq":1,"time_created":"1970-01-01T00:00:03.500Z","time_updated":"1970-01-01T00:00:03.500Z","session_title":"Split witnesses","session_directory":"/work/alpha"}\n'
    + '{"source_id":"fixture","session_id":"ses_other_abcdefghijkl","message_id":"msg_other","message_type":"user","message_seq":0,"time_created":"1970-01-01T00:00:03.000Z","time_updated":"1970-01-01T00:00:03.000Z","session_title":"Other","session_directory":"/work/beta"}\n');

  const human = cli(["tail", "--since", "1970-01-01T00:00:04Z", "--limit", "1", "--db", database]);
  assert.equal(human.status, 0);
  assert.equal(human.stdout,
    "1970-01-01T00:00:04.500Z\tassistant\tfixture\tses_newest_abcdefghijkl\tmsg_new\t0\tAlpha Beta\t/work/alpha\n");
});

test("tail rejects non-finite presentation limits", () => {
  for (const value of ["0", "-1", "1.5", "nope"]) {
    const result = cli(["tail", "--limit", value, "--db", database]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^--limit requires a positive integer\n/u);
  }
});

test("history rejects fractional and malformed limits without truncating them", () => {
  for (const bad of ["1.5", "abc", "-1", "1e2.5"]) {
    const result = cli(["history", "--since", "1970-01-01T00:00:00Z", "--limit", bad, "--db", database]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^--limit requires a non-negative integer\n/);
  }
  const empty = cli(["history", "--limit", "", "--db", database]);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /^--limit requires a value\n/);
});

test("history limit zero keeps its temporary unlimited presentation meaning", () => {
  const result = cli(["history", "--since", "1970-01-01T00:00:00Z", "--limit", "0", "--json", "--db", database]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.split("\n").filter((line) => line.length > 0).length, 3);
});

test("lookup preserves id, JSONL, and not-found behavior", () => {
  assert.equal(cli(["get-session", "-s", "ses_newest_abcdefghijkl", "--id-only", "--db", database]).stdout, "ses_newest_abcdefghijkl\n");
  assert.equal(cli(["get-session", "-C", "/work/alpha", "--json", "--db", database]).stdout,
    '{"id":"ses_newest_abcdefghijkl","title":"Alpha Beta","directory":"/work/alpha","slug":"newest","projectId":"project-a","parentId":null,"version":"1","timeCreated":1000,"timeUpdated":5000}\n');
  const missing = cli(["get-session", "-s", "missing", "--db", database]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, "session not found (session missing)\n");
});

test("a profile used with a stale V1-only locator fails naturally in the requested query", () => {
  for (const args of [
    ["search", "alpha", "--db", v1Database],
    ["history", "--db", v1Database],
    ["get-session", "-s", "ses_v1_only", "--db", v1Database],
  ]) {
    const result = cli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no such table: session_v2/);
    assert.doesNotMatch(result.stderr, /V1-only|migration|profile validation/);
  }
});

test("completed V1 residue is ignored by search, history, and lookup", () => {
  assert.equal(cli(["search", "POISON", "--title-only", "--json", "--db", database]).stdout, "");
  assert.doesNotMatch(cli(["history", "--since", "1970-01-01", "--json", "--db", database]).stdout, /POISON|ses_v1_only/);
  const lookup = cli(["get-session", "-s", "ses_v1_only_abcdefghijkl", "--db", database]);
  assert.equal(lookup.status, 1);
  assert.equal(lookup.stderr, "session not found (session ses_v1_only_abcdefghijkl)\n");
});

test("parse and database errors preserve exit statuses", () => {
  const option = cli(["search", "alpha", "--wat"]);
  assert.equal(option.status, 2);
  assert.match(option.stderr, /^unknown option: --wat\n/);
  const noTerms = cli(["search"]);
  assert.equal(noTerms.status, 1);
  const missing = cli(["history", "--db", join(directory, "missing.db")]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, "unable to open database file\n");
});
