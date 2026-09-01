import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { parseSourceProfile } from "@opencoattails/query-kysely";
import { createCliDatabase } from "./fixtures/cli-database.ts";

interface Fixture {
  readonly directory: string;
  readonly database: string;
  readonly executable: string;
  readonly invocations: string;
  readonly profile: string;
}

async function writeExecutable(path: string, version: string, namedOutput = true): Promise<void> {
  await writeFile(path, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PROFILE_INVOCATION_LOG, process.argv.slice(2).join(" ") + "\\n");
process.stderr.write("diagnostic: ${namedOutput ? "local development build" : "opencode version cache stale"}\\n");
process.stdout.write("${namedOutput ? "opencode2 " : ""}v${version}\\n");
`);
  await chmod(path, 0o755);
}

async function fixture(t: TestContext): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-profile-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, "opencode.db");
  const executable = join(directory, "opencode-fixture");
  const invocations = join(directory, "invocations.log");
  const profile = join(directory, "profile.json");
  createCliDatabase(database);
  await writeExecutable(executable, "0.0.0-local-fixture");
  await writeFile(invocations, "");
  return { directory, database, executable, invocations, profile };
}

function cli(args: readonly string[], input: Fixture) {
  return spawnSync(process.execPath, ["src/cli.ts", ...args], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, PROFILE_INVOCATION_LOG: input.invocations, TZ: "UTC" },
  });
}

async function generate(input: Fixture) {
  return cli([
    "profile", "generate",
    "--db", input.database,
    "--opencode", input.executable,
    "--output", input.profile,
    "--name", "fixture",
  ], input);
}

test("profile generate parses opaque local versions and writes a strict atomic profile", async (t) => {
  const input = await fixture(t);
  const result = await generate(input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "diagnostic: local development build\n");
  assert.equal(result.stdout, `generated profile fixture at ${input.profile}\n`);

  const profile = parseSourceProfile(await readFile(input.profile, "utf8"));
  assert.equal(profile.opencode.generated_with, "0.0.0-local-fixture");
  assert.deepEqual(profile.opencode.compatible_versions, ["0.0.0-local-fixture"]);
  assert.equal(profile.source.path, input.database);
  assert.equal(profile.certificates, undefined);
  assert.deepEqual(profile.content.observed_message_variants, ["assistant", "user"]);
  assert.deepEqual((await readdir(input.directory)).sort(), ["invocations.log", "opencode-fixture", "opencode.db", "profile.json"]);
  assert.equal((await stat(input.profile)).mode & 0o777, 0o600);
  assert.equal(await readFile(input.invocations, "utf8"), "--version\n");
});

test("profile show reads and decodes profile JSON without executable or database access", async (t) => {
  const input = await fixture(t);
  assert.equal((await generate(input)).status, 0);
  await writeFile(input.invocations, "");
  await rm(input.executable);
  await rm(input.database);

  const result = cli(["profile", "show", "--profile", input.profile], input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseSourceProfile(result.stdout).profile_id, "fixture");
  assert.equal(result.stderr, "");
  assert.equal(await readFile(input.invocations, "utf8"), "");
});

test("profile validate performs only selected explicit checks and reports absent certificates honestly", async (t) => {
  const input = await fixture(t);
  assert.equal((await generate(input)).status, 0);
  const result = cli([
    "profile", "validate", "--profile", input.profile,
    "--version", "--schema", "--indexes", "--content", "--plans",
  ], input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout,
    "version: compatible (0.0.0-local-fixture)\n"
    + "schema: match\n"
    + "indexes: match\n"
    + "content: match\n"
    + "plans: no certificates recorded\n");
  assert.equal(await readFile(input.invocations, "utf8"), "--version\n--version\n");

  const database = new DatabaseSync(input.database);
  database.exec("DROP INDEX IF EXISTS session_message_session_seq_idx; CREATE INDEX changed_idx ON session_message(seq, session_id)");
  database.close();
  const mismatch = cli(["profile", "validate", "--profile", input.profile, "--indexes"], input);
  assert.equal(mismatch.status, 1);
  assert.equal(mismatch.stdout, "indexes: mismatch\n");
  assert.equal(mismatch.stderr, "profile validation failed\n");
  assert.equal(await readFile(input.invocations, "utf8"), "--version\n--version\n");
});

test("profile refresh preserves profile identity and source path while replacing version facts atomically", async (t) => {
  const input = await fixture(t);
  assert.equal((await generate(input)).status, 0);
  await writeExecutable(input.executable, "0.0.0-local-refreshed", false);
  const result = cli(["profile", "refresh", "--profile", input.profile], input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `refreshed profile fixture at ${input.profile}\n`);
  const profile = parseSourceProfile(await readFile(input.profile, "utf8"));
  assert.equal(profile.profile_id, "fixture");
  assert.equal(profile.source.path, input.database);
  assert.equal(profile.opencode.generated_with, "0.0.0-local-refreshed");
  assert.deepEqual(profile.opencode.compatible_versions, ["0.0.0-local-refreshed"]);
  assert.equal(profile.certificates, undefined);
  assert.equal((await readdir(input.directory)).some((name) => name.includes(".tmp")), false);
});

test("ordinary commands do not invoke OpenCode for profile discovery or validation", async (t) => {
  const input = await fixture(t);
  const result = cli(["search", "Alpha", "--title-only", "--json", "--db", input.database], input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(input.invocations, "utf8"), "");
});
