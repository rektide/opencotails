import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { messageCreatedBounds, parseArgs } from "../src/commands/search.ts";
import {
  indexedOpenCodeV2Fixture,
  validMessageData,
} from "../packages/query-kysely/test/fixtures/opencode-v2/index.ts";
import { writeCliSourceProfile } from "./fixtures/profile/index.ts";

const DAY = 86_400_000;
// Day-scale timeline: the default 21d backfill window must actually exclude
// Message history for the false-negative contract to be observable.
const UPDATED_CUTOFF = "1970-01-30T00:00:00Z"; // D29
const MESSAGE_CUTOFF = "1970-01-27T00:00:00Z"; // D26

async function createSinceUpdatedDatabase(path: string): Promise<void> {
  const fixture = indexedOpenCodeV2Fixture({ path, pendingInput: true });
  const db = fixture.database;
  try {
    const session = db.prepare(`
      INSERT INTO session_v2
        (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // ses_fresh: updated D30, needle Message created D30.
    session.run("ses_fresh", "project-a", null, "fresh", "/work/fresh", "Fresh Work", "1", 25 * DAY, 30 * DAY);
    // ses_stale: updated D29, needle Message created D0 behind every backfill
    // window below 29d, plus a D28 Message that keeps the Session active.
    session.run("ses_stale", "project-a", null, "stale", "/work/stale", "Stale resumed", "1", 0, 29 * DAY);
    // ses_old_update: recent needle content (D26) but only updated D27, so the
    // exact updated cutoff must exclude it from every --since-updated result.
    session.run("ses_old_update", "project-b", null, "old-update", "/work/old", "Old update", "1", 0, 27 * DAY);

    const message = db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)");
    const seq = new Map<string, number>();
    const add = (id: string, sessionID: string, created: number, text: string) => {
      const order = seq.get(sessionID) ?? 0;
      seq.set(sessionID, order + 1);
      message.run(
        id, sessionID, "user", order, created, created,
        JSON.stringify({ ...validMessageData("user", id, created), text }),
      );
    };
    add("msg_fresh", "ses_fresh", 30 * DAY, "needle fresh drop");
    add("msg_old", "ses_stale", 0, "needle from the distant past");
    add("msg_touch", "ses_stale", 28 * DAY, "resumed work");
    add("msg_old_update", "ses_old_update", 26 * DAY, "needle from the old session");
    fixture.completeMigration();
  } finally {
    db.close();
  }
}

const directory = await mkdtemp(join(tmpdir(), "cotail-since-updated-"));
const database = join(directory, "fixture.db");
await createSinceUpdatedDatabase(database);
const profile = join(directory, "fixture-profile.json");
await writeCliSourceProfile(database, profile);
after(() => rm(directory, { recursive: true, force: true }));

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function invokeCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/cli.ts", ...args], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function cli(args: readonly string[]): Promise<CliResult> {
  return invokeCli([...args, "--profile", profile]);
}

// Parse errors exit before the profile is consulted, so end-of-argv cases run
// without the appended --profile that would otherwise become the flag value.
function cliWithoutProfile(args: readonly string[]): Promise<CliResult> {
  return invokeCli(args);
}

interface HitRow {
  readonly id: string;
  readonly snippet?: string;
}

async function hits(args: readonly string[]): Promise<readonly (readonly [string, string])[]> {
  const result = await cli(args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n").filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as HitRow)
    .map((row) => [row.id, row.snippet ?? ""] as const);
}

const needle = ["search", "needle", "--json"] as const;
const FRESH: readonly [string, string] = ["ses_fresh", "needle fresh drop"];
const STALE: readonly [string, string] = ["ses_stale", "needle from the distant past"];

test("--since-updated filters Sessions exactly and, disabled backfill, searches all history", async () => {
  assert.deepEqual(await hits([...needle, "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill", "off"]), [FRESH, STALE]);
  // ses_old_update carries fresh needle content but was not updated in range.
  assert.deepEqual(
    await hits([...needle, "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill", "none"]),
    [FRESH, STALE],
  );
});

test("default 21d backfill bounds Message history and can miss older matches", async () => {
  // Cutoff D29 minus 21d hides ses_stale's D0 needle even though the Session
  // itself is updated in range: the documented false negative.
  assert.deepEqual(await hits([...needle, "--since-updated", UPDATED_CUTOFF]), [FRESH]);
});

test("custom backfill windows widen the Message history search", async () => {
  assert.deepEqual(
    await hits([...needle, `--since-updated=${UPDATED_CUTOFF}`, "--since-updated-backfill=30d"]),
    [FRESH, STALE],
  );
  // 29d reaches exactly to D0; shorter windows reproduce the false negative.
  assert.deepEqual(
    await hits([...needle, "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill", "28d"]),
    [FRESH],
  );
});

test("all four disable spellings turn off the Message bound via = and space forms", async () => {
  for (const value of ["off", "false", "none", "-1"]) {
    assert.deepEqual(
      await hits([...needle, "--since-updated", UPDATED_CUTOFF, `--since-updated-backfill=${value}`]),
      [FRESH, STALE],
      value,
    );
  }
  assert.deepEqual(
    await hits([...needle, "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill", "false"]),
    [FRESH, STALE],
  );
  // The negative-number disable spelling survives the option-looking-value rule.
  assert.deepEqual(
    await hits([...needle, "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill", "-1"]),
    [FRESH, STALE],
  );
});

test("combined --since and --since-updated enforce both cutoffs with the stricter Message bound", async () => {
  // Backfill 30d bounds Messages at D-1, but --since D26 wins as the stricter
  // bound: ses_stale's D0 needle stays hidden; ses_old_update would match the
  // Message cutoff yet fails the exact updated cutoff.
  assert.deepEqual(
    await hits([...needle, "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill", "30d", "--since", MESSAGE_CUTOFF]),
    [FRESH],
  );
});

test("disabling the updated backfill keeps an explicit --since Message bound", async () => {
  assert.deepEqual(
    await hits([...needle, "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill=off", "--since", MESSAGE_CUTOFF]),
    [FRESH],
  );
});

test("--since alone keeps its exact Message-created semantics", async () => {
  assert.deepEqual(await hits([...needle, `--since=${MESSAGE_CUTOFF}`]), [
    FRESH,
    ["ses_old_update", "needle from the old session"],
  ]);
});

test("--title-only ignores heuristic backfill but honors explicit Message activity", async () => {
  assert.deepEqual(
    await hits(["search", "Stale", "--title-only", "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill=off", "--json"]),
    [["ses_stale", ""]],
  );
  // Root-local title matching needs no Message-history search, so the implicit
  // content backfill cannot introduce a false negative.
  assert.deepEqual(
    await hits(["search", "Stale", "--title-only", "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill", "12h", "--json"]),
    [["ses_stale", ""]],
  );
  // Explicit --since still means Message activity for title-only search.
  assert.deepEqual(
    await hits(["search", "Stale", "--title-only", "--since-updated", UPDATED_CUTOFF,
      "--since", "1970-01-29T12:00:00Z", "--json"]),
    [],
  );
});

test("backfill and time values reject malformed arguments with exit status 2", async () => {
  const cases: readonly (readonly [readonly string[], RegExp])[] = [
    [[...needle, "--since-updated-backfill", "5d"], /^--since-updated-backfill requires --since-updated\n/],
    [[...needle, "--since-updated-backfill=5d"], /^--since-updated-backfill requires --since-updated\n/],
    [[...needle, "--since-updated", "7d", "--since-updated-backfill", "21x"], /^--since-updated-backfill: unrecognized duration "21x"/],
    [[...needle, "--since-updated", "7d", "--since-updated-backfill", "1.5d"], /^--since-updated-backfill: unrecognized duration "1\.5d"/],
    [[...needle, "--since-updated", "7d", "--since-updated-backfill", "-2"], /^--since-updated-backfill: unrecognized duration "-2"/],
    [[...needle, "--since-updated", "wat"], /^--since-updated: unrecognized time "wat"/],
    [[...needle, "--since-updated", "7d", "--since-updated-backfill"], /^--since-updated-backfill requires a value\n/],
    [[...needle, "--since-updated", "7d", "--since-updated-backfill="], /^--since-updated-backfill requires a value\n/],
  ];
  for (const [args, message] of cases) {
    const result = await cli(args);
    assert.equal(result.status, 2, JSON.stringify({ args, stderr: result.stderr }));
    assert.match(result.stderr, message);
  }
  // Option-looking next tokens count as missing values in separated form.
  for (const [args, message] of [
    [[...needle, "--since-updated", "--profile"], /^--since-updated requires a value\n/],
    [[...needle, "--since-updated", "7d", "--since-updated-backfill", "--json"], /^--since-updated-backfill requires a value\n/],
    [[...needle, "--since-updated", "7d", "--since-updated-backfill", "-F"], /^--since-updated-backfill requires a value\n/],
  ] as const) {
    const result = await cli(args);
    assert.equal(result.status, 2, JSON.stringify({ args, stderr: result.stderr }));
    assert.match(result.stderr, message);
  }
  // Trailing space-form flags only miss their value at true end-of-argv.
  for (const [args, message] of [
    [[...needle, "--since-updated"], /^--since-updated requires a value\n/],
    [[...needle, "--since-updated", "7d", "--since-updated-backfill"], /^--since-updated-backfill requires a value\n/],
  ] as const) {
    const result = await cliWithoutProfile(args);
    assert.equal(result.status, 2, JSON.stringify({ args, stderr: result.stderr }));
    assert.match(result.stderr, message);
  }
  // The rejection is order-independent: backfill before its --since-updated.
  assert.deepEqual(
    await hits([...needle, "--since-updated-backfill=5d", "--since-updated", UPDATED_CUTOFF]),
    [FRESH],
  );
});

test("parsed bounds keep explicit --since distinct from the updated-backfill heuristic", () => {
  const both = parseArgs([
    "needle", "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill", "5d", "--since", MESSAGE_CUTOFF,
  ]);
  assert.equal(both.sinceMs, 26 * DAY);
  assert.equal(both.sinceUpdatedMs, 29 * DAY);
  assert.equal(both.sinceUpdatedBackfillMs, 5 * DAY);
  const bounds = messageCreatedBounds(both);
  assert.equal(bounds.sinceMs, 26 * DAY);
  assert.equal(bounds.updatedBackfillFromMs, 24 * DAY);
  assert.equal(bounds.fromMs, 26 * DAY);

  // Without --since, only the heuristic bound exists; default 21d resolves here.
  const heuristic = parseArgs(["needle", "--since-updated", UPDATED_CUTOFF]);
  assert.equal(heuristic.sinceMs, undefined);
  assert.equal(heuristic.sinceUpdatedBackfillMs, 21 * DAY);
  const heuristicBounds = messageCreatedBounds(heuristic);
  assert.equal(heuristicBounds.sinceMs, undefined);
  assert.equal(heuristicBounds.updatedBackfillFromMs, 8 * DAY);
  assert.equal(heuristicBounds.fromMs, 8 * DAY);

  // Disabling the backfill removes the heuristic bound but never the explicit one.
  const disabled = parseArgs([
    "needle", "--since-updated", UPDATED_CUTOFF, "--since-updated-backfill=off", "--since", MESSAGE_CUTOFF,
  ]);
  const disabledBounds = messageCreatedBounds(disabled);
  assert.equal(disabledBounds.updatedBackfillFromMs, undefined);
  assert.equal(disabledBounds.sinceMs, 26 * DAY);
  assert.equal(disabledBounds.fromMs, 26 * DAY);

  const bare = parseArgs(["needle"]);
  // Absent bounds are omitted entirely so spread presence can drive wiring.
  assert.deepEqual(messageCreatedBounds(bare), {});
  assert.deepEqual(Object.keys(messageCreatedBounds(bare)), []);
});

test("search help documents the backfill false-negative tradeoff", async () => {
  const result = await cli(["search", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--since-updated-backfill <dur>/);
  assert.match(result.stdout, /false negative/);
  assert.match(result.stdout, /default: 21d/);
});
