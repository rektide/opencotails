import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { Table, tableFromIPC } from "apache-arrow";
import { createCliDatabase } from "./fixtures/cli-database.ts";

const directory = mkdtempSync(join(tmpdir(), "cotail-arrow-"));
const database = join(directory, "fixture.db");
createCliDatabase(database);
const fixture = new DatabaseSync(database);
fixture.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  "ses_unicode_abcdefghijkl",
  "project-u",
  null,
  "unicode",
  "/work/日本語",
  "Café 猫",
  "1",
  6000,
  7000,
);
fixture.close();
after(() => rmSync(directory, { recursive: true, force: true }));

function cli(args: readonly string[]) {
  return spawnSync(process.execPath, ["src/cli.ts", ...args], {
    cwd: new URL("..", import.meta.url),
    encoding: "buffer",
    env: { ...process.env, TZ: "UTC" },
  });
}

function decode(stdout: Buffer): Table {
  return tableFromIPC(new Uint8Array(stdout));
}

function fields(table: Table) {
  return table.schema.fields.map((field) => ({
    name: field.name,
    type: String(field.type),
    nullable: field.nullable,
  }));
}

test("search emits clean stream IPC with multiple rows, evidence, counts, and timestamps", () => {
  const result = cli(["search", "alpha", "--arrow", "--db", database]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr.length, 0);
  const table = decode(result.stdout);
  assert.equal(table.numRows, 3);
  assert.deepEqual(fields(table), [
    { name: "id", type: "Utf8", nullable: false },
    { name: "slug", type: "Utf8", nullable: false },
    { name: "title", type: "Utf8", nullable: false },
    { name: "directory", type: "Utf8", nullable: false },
    { name: "time_created", type: "Timestamp<MILLISECOND>", nullable: false },
    { name: "time_updated", type: "Timestamp<MILLISECOND>", nullable: false },
    { name: "evidence_text", type: "Utf8", nullable: true },
  ]);
  assert.deepEqual(table.get(0)?.toJSON(), {
    id: "ses_newest_abcdefghijkl",
    slug: "newest",
    title: "Alpha Beta",
    directory: "/work/alpha",
    time_created: 1000,
    time_updated: 5000,
    evidence_text: "alpha beta first snippet",
  });
});

test("search preserves typed empty output, optional nulls, and Unicode", () => {
  const emptyResult = cli(["search", "absent", "--arrow", "--db", database]);
  assert.equal(emptyResult.status, 0);
  assert.equal(emptyResult.stderr.length, 0);
  const empty = decode(emptyResult.stdout);
  assert.equal(empty.numRows, 0);
  assert.equal(empty.numCols, 7);
  assert.equal(empty.schema.fields[6]?.nullable, true);

  const nullResult = cli(["search", "Alpha", "--title-only", "--arrow", "--db", database]);
  assert.equal(nullResult.status, 0);
  assert.equal(decode(nullResult.stdout).get(0)?.evidence_text, null);

  const unicodeResult = cli(["search", "Café", "--title-only", "--arrow", "--db", database]);
  assert.equal(unicodeResult.status, 0);
  assert.equal(unicodeResult.stderr.length, 0);
  assert.deepEqual(decode(unicodeResult.stdout).get(0)?.toJSON(), {
    id: "ses_unicode_abcdefghijkl",
    slug: "unicode",
    title: "Café 猫",
    directory: "/work/日本語",
    time_created: 6000,
    time_updated: 7000,
    evidence_text: null,
  });
});

test("history uses Int64 counts and millisecond timestamps", () => {
  const result = cli(["history", "--since", "1970-01-01T00:00:00Z", "--arrow", "--db", database]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr.length, 0);
  const table = decode(result.stdout);
  assert.equal(table.numRows, 4);
  assert.equal(String(table.schema.fields[4]?.type), "Int64");
  assert.equal(String(table.schema.fields[6]?.type), "Timestamp<MILLISECOND>");
  assert.deepEqual(table.get(1)?.toJSON(), {
    id: "ses_newest_abcdefghijkl",
    title: "Alpha Beta",
    directory: "/work/alpha",
    slug: "newest",
    messages_recent: 1n,
    messages_total: 1n,
    time_created: 1000,
    time_updated: 5000,
  });
});

test("get-session emits its distinct schema and nullable parent", () => {
  const result = cli(["get-session", "-s", "ses_newest_abcdefghijkl", "--arrow", "--db", database]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr.length, 0);
  const table = decode(result.stdout);
  assert.equal(table.numRows, 1);
  assert.equal(table.schema.fields[5]?.name, "parent_id");
  assert.equal(table.schema.fields[5]?.nullable, true);
  assert.equal(table.get(0)?.parent_id, null);
  assert.equal(table.get(0)?.project_id, "project-a");
  assert.equal(table.get(0)?.time_updated, 5000);
});

test("Arrow conflicts with existing text output flags before writing stdout", () => {
  for (const args of [
    ["search", "alpha", "--arrow", "--json"],
    ["history", "--arrow", "--tsv"],
    ["get-session", "--arrow", "--id-only"],
  ]) {
    const result = cli(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString(), /^--arrow cannot be combined with --/);
  }

  const noTerms = cli(["search", "--arrow"]);
  assert.equal(noTerms.status, 1);
  assert.equal(noTerms.stdout.length, 0);
  assert.equal(noTerms.stderr.toString(), "search requires at least one pattern\n");
});
