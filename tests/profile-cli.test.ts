import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseSourceProfile } from "@opencoattails/query-kysely";
import {
  createCliDatabase,
  createProfileCliFixture,
  type ProfileCliFixture,
  writeVersionExecutable,
} from "./fixtures/profile/index.ts";

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function cli(
  args: readonly string[],
  input: ProfileCliFixture,
  environment: Readonly<Record<string, string>> = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/cli.ts", ...args], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PROFILE_INVOCATION_LOG: input.invocations, TZ: "UTC", ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function generate(input: ProfileCliFixture) {
  return await cli([
    "profile", "generate",
    "--db", input.database,
    "--opencode", input.executable,
    "--output", input.profile,
    "--name", "fixture",
  ], input);
}

test("profile generate parses opaque local versions and writes a strict atomic profile", async (t) => {
  const input = await createProfileCliFixture(t);
  const result = await generate(input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "diagnostic: local development build\n");
  assert.equal(result.stdout, `generated profile fixture at ${input.profile}\n`);

  const profile = parseSourceProfile(await readFile(input.profile, "utf8"));
  const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(profile.generator.version, packageMetadata.version);
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
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  await writeFile(input.invocations, "");
  await rm(input.executable);
  await rm(input.database);

  const result = await cli(["profile", "show", "--profile", input.profile], input);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseSourceProfile(result.stdout).profile_id, "fixture");
  assert.equal(result.stderr, "");
  assert.equal(await readFile(input.invocations, "utf8"), "");
});

test("profile validate performs only selected explicit checks and reports absent certificates honestly", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  const result = await cli([
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
  const schemaMatch = await cli(["profile", "validate", "--profile", input.profile, "--schema"], input);
  assert.equal(schemaMatch.status, 0, schemaMatch.stderr);
  assert.equal(schemaMatch.stdout, "schema: match\n");
  const mismatch = await cli(["profile", "validate", "--profile", input.profile, "--indexes"], input);
  assert.equal(mismatch.status, 1);
  assert.equal(mismatch.stdout, "indexes: mismatch\n");
  assert.equal(mismatch.stderr, "profile validation failed\n");
  assert.equal(await readFile(input.invocations, "utf8"), "--version\n--version\n");
});

test("profile validation requires an explicit selector and plans do not touch absent runtime resources", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  await writeFile(input.invocations, "");
  await rm(input.executable);
  await rm(input.database);

  const bare = await cli(["profile", "validate", "--profile", input.profile], input);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /at least one validation selector is required/u);
  assert.equal(await readFile(input.invocations, "utf8"), "");

  const plans = await cli(["profile", "validate", "--profile", input.profile, "--plans"], input);
  assert.equal(plans.status, 0, plans.stderr);
  assert.equal(plans.stdout, "plans: no certificates recorded\n");
  assert.equal(await readFile(input.invocations, "utf8"), "");
});

test("each explicit profile validator touches only its selected runtime resources", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  await input.resetInvocations();
  await rm(input.database);

  const version = await cli(["profile", "validate", "--profile", input.profile, "--version"], input);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, "version: compatible (0.0.0-local-fixture)\n");
  assert.equal(await input.readInvocations(), "--version\n");

  await createCliDatabase(input.database);
  await input.resetInvocations();
  await rm(input.executable);
  for (const [selector, output] of [
    ["--schema", "schema: match\n"],
    ["--indexes", "indexes: match\n"],
    ["--content", "content: match\n"],
  ] as const) {
    const result = await cli(["profile", "validate", "--profile", input.profile, selector], input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, output);
  }
  assert.equal(await input.readInvocations(), "");
});

test("schema and index selectors compare independent profile facts", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  const database = new DatabaseSync(input.database);
  database.exec("ALTER TABLE session_message ADD COLUMN future_value TEXT");
  database.close();

  const schema = await cli(["profile", "validate", "--profile", input.profile, "--schema"], input);
  assert.equal(schema.status, 1);
  assert.equal(schema.stdout, "schema: mismatch\n");
  const indexes = await cli(["profile", "validate", "--profile", input.profile, "--indexes"], input);
  assert.equal(indexes.status, 0, indexes.stderr);
  assert.equal(indexes.stdout, "indexes: match\n");
});

test("validation detects newly present relevant optional tables but ignores unrelated tables", async (t) => {
  const input = await createProfileCliFixture(t);
  let database = new DatabaseSync(input.database);
  database.exec("DROP TABLE event; DROP TABLE event_sequence; DROP TABLE session_pending");
  database.close();
  assert.equal((await generate(input)).status, 0);

  database = new DatabaseSync(input.database);
  database.exec(`
    CREATE TABLE session_pending (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
      delivery TEXT, admitted_seq INTEGER NOT NULL, time_created INTEGER NOT NULL
    );
  `);
  database.close();
  const relevant = await cli(["profile", "validate", "--profile", input.profile, "--schema"], input);
  assert.equal(relevant.status, 1);
  assert.equal(relevant.stdout, "schema: mismatch\n");
  const relevantIndexes = await cli(["profile", "validate", "--profile", input.profile, "--indexes"], input);
  assert.equal(relevantIndexes.status, 1);
  assert.equal(relevantIndexes.stdout, "indexes: mismatch\n");

  assert.equal((await generate(input)).status, 0);
  database = new DatabaseSync(input.database);
  database.exec("CREATE TABLE unrelated_extension (id TEXT PRIMARY KEY)");
  database.close();
  const unrelated = await cli(["profile", "validate", "--profile", input.profile, "--schema", "--indexes"], input);
  assert.equal(unrelated.status, 0, unrelated.stderr);
  assert.equal(unrelated.stdout, "schema: match\nindexes: match\n");
});

test("plan validation rejects recorded certificates as unsupported rather than claiming evidence", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  const stored = JSON.parse(await readFile(input.profile, "utf8")) as Record<string, unknown>;
  stored.certificates = {
    "history.activity": {
      contract: 1,
      runtime: { node: "26.6.0", sqlite: "3.53.3" },
      outer: "qualified_sessions",
      related: "session_message",
      access: "search",
      keys: ["session_id"],
    },
  };
  await writeFile(input.profile, `${JSON.stringify(stored)}\n`);
  const result = await cli(["profile", "validate", "--profile", input.profile, "--plans"], input);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "plans: unsupported for recorded certificates (history.activity)\n");
  assert.equal(result.stderr, "profile validation failed\n");
});

test("profile refresh preserves profile identity and source path while replacing version facts atomically", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  await writeVersionExecutable({
    path: input.executable,
    version: "0.0.0-local-refreshed",
    namedOutput: false,
  });
  const result = await cli(["profile", "refresh", "--profile", input.profile], input);
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

test("ordinary commands work without OpenCode in PATH and do no profile discovery or validation", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  await writeFile(input.invocations, "");
  await rm(input.executable);
  const database = new DatabaseSync(input.database);
  database.exec(`
    DROP TABLE kv;
    INSERT INTO session_message VALUES (
      'msg_future', 'ses_other_abcdefghijkl', 'future-message', 1, 1, 1, '{}'
    );
  `);
  database.close();

  const result = await cli([
    "search", "Alpha", "--title-only", "--json",
    "--profile", input.profile,
  ], input, { PATH: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ses_newest_abcdefghijkl/u);
  assert.equal(await readFile(input.invocations, "utf8"), "");
});

test("ordinary commands use the conventional XDG profile when --profile is omitted", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  await writeFile(input.invocations, "");
  const configHome = join(input.directory, "config");
  const conventional = join(configHome, "cotail", "profiles", "opencode-local.json");
  await mkdir(join(configHome, "cotail", "profiles"), { recursive: true });
  await writeFile(conventional, await readFile(input.profile));

  const result = await cli([
    "get-session", "-s", "ses_newest_abcdefghijkl", "--id-only",
  ], input, { XDG_CONFIG_HOME: configHome });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ses_newest_abcdefghijkl\n");
  assert.equal(await readFile(input.invocations, "utf8"), "");
});

test("ordinary commands report missing and malformed profiles with exact generation commands", async (t) => {
  const input = await createProfileCliFixture(t);
  const databaseMustNotOpen = join(input.directory, "database-must-not-open.db");
  const missingResult = await cli([
    "history", "--profile", input.missingProfile, "--db", databaseMustNotOpen,
  ], input);
  assert.equal(missingResult.status, 1);
  assert.equal(missingResult.stderr,
    `source profile not found: ${input.missingProfile}\n`
    + "Generate it with:\n"
    + `cotail profile generate --db '${databaseMustNotOpen}' --opencode opencode --output '${input.missingProfile}' --name opencode-local\n`);
  await assert.rejects(stat(databaseMustNotOpen), { code: "ENOENT" });
  assert.equal(await input.readInvocations(), "");

  await input.writeMalformedProfile();
  const malformedResult = await cli([
    "get-session", "-s", "ses_newest_abcdefghijkl",
    "--profile", input.malformedProfile,
    "--db", input.database,
  ], input);
  assert.equal(malformedResult.status, 1);
  assert.equal(malformedResult.stderr.startsWith(`source profile is malformed: ${input.malformedProfile}\n`), true);
  assert.match(malformedResult.stderr, /Regenerate it with:\ncotail profile generate --db /u);
  assert.equal(await readFile(input.invocations, "utf8"), "");
});

test("a stale profile fails through the requested SQLite operation without validation fallback", async (t) => {
  const input = await createProfileCliFixture(t);
  assert.equal((await generate(input)).status, 0);
  await input.resetInvocations();
  await input.writeStaleDatabase();

  const result = await cli([
    "history", "--profile", input.profile, "--db", input.staleDatabase,
  ], input);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no such table: session_v2/u);
  assert.doesNotMatch(result.stderr, /profile validation|V1-only|migration|refresh/u);
  assert.equal(await input.readInvocations(), "");
});
