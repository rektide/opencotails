import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  parseOpenCodeVersionOutput,
  runOpenCodeVersion,
} from "../src/opencode/version.ts";

async function executable(t: TestContext, body: string): Promise<{ readonly path: string; readonly pid: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-version-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "opencode-fixture");
  const pid = join(directory, "pid");
  await writeFile(path, `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(pid)}, String(process.pid));
${body}
`);
  await chmod(path, 0o755);
  return { path, pid };
}

function assertProcessExited(pid: number): void {
  assert.throws(() => process.kill(pid, 0), (error) => {
    assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
    return true;
  });
}

test("version parsing accepts exact local and release forms amid diagnostics", () => {
  assert.equal(parseOpenCodeVersionOutput("opencode2 v0.0.0-local-20260901\n"), "0.0.0-local-20260901");
  assert.equal(parseOpenCodeVersionOutput("1.18.4\n", "diagnostic: local build\n"), "1.18.4");
  assert.equal(parseOpenCodeVersionOutput(
    "starting diagnostic\nopencode vnightly_20260901\nfinished diagnostic\n",
  ), "nightly_20260901");
});

test("version parsing rejects prose, malformed output, and ambiguous versions", () => {
  assert.throws(() => parseOpenCodeVersionOutput("", "opencode version cache stale\n"), /could not parse/u);
  assert.throws(() => parseOpenCodeVersionOutput("diagnostic only\n"), /could not parse/u);
  assert.throws(() => parseOpenCodeVersionOutput("1.18.4\n1.18.5\n"), /ambiguous/u);
});

test("version execution bounds output and reaps a process that ignores SIGTERM", async (t) => {
  const fixture = await executable(t, `
process.on("SIGTERM", () => {});
const chunk = "x".repeat(4096);
setInterval(() => process.stdout.write(chunk), 0);
`);
  await assert.rejects(runOpenCodeVersion(fixture.path, {
    maxOutputBytes: 1024,
    timeoutMs: 5_000,
    terminateGraceMs: 50,
  }), /output exceeded 1024 bytes/u);
  assertProcessExited(Number(await readFile(fixture.pid, "utf8")));
});

test("version execution times out and escalates termination without leaving a process", async (t) => {
  const fixture = await executable(t, `
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
`);
  await assert.rejects(runOpenCodeVersion(fixture.path, {
    maxOutputBytes: 1024,
    timeoutMs: 500,
    terminateGraceMs: 50,
  }), /timed out after 500 ms/u);
  assertProcessExited(Number(await readFile(fixture.pid, "utf8")));
});
