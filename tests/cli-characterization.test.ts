import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { createCliDatabase } from "./fixtures/cli-database.ts";

const directory = mkdtempSync(join(tmpdir(), "cotail-characterization-"));
const database = join(directory, "fixture.db");
createCliDatabase(database);
after(() => rmSync(directory, { recursive: true, force: true }));

function cli(args: readonly string[]) {
  return spawnSync(process.execPath, ["src/cli.ts", ...args], {
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

test("lookup preserves id, JSONL, and not-found behavior", () => {
  assert.equal(cli(["get-session", "-s", "ses_newest_abcdefghijkl", "--id-only", "--db", database]).stdout, "ses_newest_abcdefghijkl\n");
  assert.equal(cli(["get-session", "-C", "/work/alpha", "--json", "--db", database]).stdout,
    '{"id":"ses_newest_abcdefghijkl","title":"Alpha Beta","directory":"/work/alpha","slug":"newest","projectId":"project-a","parentId":null,"version":"1","timeCreated":1000,"timeUpdated":5000}\n');
  const missing = cli(["get-session", "-s", "missing", "--db", database]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, "session not found (session missing)\n");
});

test("parse and database errors preserve exit statuses", () => {
  const option = cli(["search", "alpha", "--wat"]);
  assert.equal(option.status, 2);
  assert.match(option.stderr, /^unknown option: --wat\n/);
  const noTerms = cli(["search"]);
  assert.equal(noTerms.status, 1);
  const missing = cli(["history", "--db", join(directory, "missing.db")]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, `db not found: ${join(directory, "missing.db")}\n`);
});
