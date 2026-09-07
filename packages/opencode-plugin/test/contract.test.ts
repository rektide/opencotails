import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { CotailRead } from "../src/rpc.ts";
import type { Rpc } from "@opencode-ai/plugin/rpc";

test("RPC contract retains typed finite Session input and declared errors", () => {
  const input: Rpc.Input<typeof CotailRead.methods.sessionGet.input> = {
    schema: "cotail.session-get.input/v1", sessionID: "ses_child",
  };
  assert(CotailRead.methods.sessionGet.input.safeParse(input).success);
  assert(!CotailRead.methods.sessionGet.input.safeParse({ ...input, databasePath: "/not-allowed" }).success);
  assert.equal(CotailRead.id, "cotail.read");
  assert.deepEqual(Object.keys(CotailRead.methods), ["sessionGet"]);
  assert.deepEqual(Object.keys(CotailRead.methods.sessionGet.errors), ["read_failed"]);
});

test("portable RPC export loads without SQLite, Core, Server or Effect runtime imports", async () => {
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'effect' || specifier.startsWith('effect/') || specifier === 'node:sqlite' ||
          specifier.startsWith('@opencode-ai/core') || specifier.startsWith('@opencode-ai/server'))
        throw new Error('Forbidden portable dependency: ' + specifier);
      return next(specifier, context);
    }});
    const { CotailRead } = await import(${JSON.stringify(new URL("../src/rpc.ts", import.meta.url).href)});
    console.log(CotailRead.id);
  `;
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script]);
  assert.equal(result.stdout, "cotail.read\n");
  assert.equal(result.stderr, "");
});
