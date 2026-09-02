import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isBrokenPipe, parseArgs } from "../src/commands/watch.ts";
import { createCliDatabase, writeCliSourceProfile } from "./fixtures/profile/index.ts";

test("watch parsing preserves moving/fixed horizons and explicit output modes", () => {
  assert.deepEqual(parseArgs(["--since", "2h", "--format", "jsonl", "--interval", "3s"]), {
    since: { kind: "relative", durationMs: 7_200_000 },
    limit: 50,
    intervalMs: 3_000,
    format: "jsonl",
    includeInitial: true,
    once: false,
    dbPath: undefined,
    profilePath: undefined,
  });
  assert.deepEqual(parseArgs(["--since=1970-01-01T00:00:01Z", "--no-initial"]), {
    since: { kind: "absolute", cutoffMs: 1_000 },
    limit: 50,
    intervalMs: 2_000,
    format: "human",
    includeInitial: false,
    once: false,
    dbPath: undefined,
    profilePath: undefined,
  });
});

test("only EPIPE is a quiet output failure", () => {
  assert.equal(isBrokenPipe(Object.assign(new Error("closed"), { code: "EPIPE" })), true);
  assert.equal(isBrokenPipe(Object.assign(new Error("bad"), { code: "EIO" })), false);
  assert.equal(isBrokenPipe(new Error("bad")), false);
});

test("SIGTERM aborts a live watch and releases its source cleanly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cotail-watch-signal-"));
  const database = join(directory, "fixture.db");
  const profile = join(directory, "profile.json");
  await createCliDatabase(database);
  await writeCliSourceProfile(database, profile);
  try {
    const child = spawn(process.execPath, [
      "src/cli.ts", "watch", "--since", "1970-01-01", "--interval", "10s",
      "--json", "--profile", profile, "--db", database,
    ], {
      cwd: new URL("..", import.meta.url),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TZ: "UTC" },
    });
    let stdout = "";
    let stderr = "";
    let stopped = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!stopped) {
        stopped = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    const result = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    clearTimeout(timeout);

    assert.equal(stopped, true);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(stderr, "");
    assert.match(stdout, /"observation":"initial"/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
