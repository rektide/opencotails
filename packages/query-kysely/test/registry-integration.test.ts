import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { QueryRegistry, queryRegistryLayer } from "@opencoattails/query-runtime";
import {
  logicalKyselyCapability,
  logicalKyselyQueryKey,
  nodeLogicalKyselyQueryFactory,
} from "../src/runtime/registry.ts";
import { openCodeV2Fixture } from "./fixtures/opencode-v2.ts";

test("registers the canonical scoped logical world", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cotail-registry-"));
  const path = join(directory, "opencode.db");
  const fixture = openCodeV2Fixture();
  fixture.database.exec(`
    insert into session_v2 (
      id, project_id, slug, directory, version, cost, tokens_input,
      tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      time_created, time_updated
    ) values ('ses_registry', 'p', 'r', '/', '2', 0, 0, 0, 0, 0, 0, 1, 1)
  `);
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();

  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* QueryRegistry;
        const instance = yield* registry.get(logicalKyselyQueryKey);
        const rows = yield* instance.world.run(({ db }) => db.selectFrom("cotail_session").select("sessionID"));
        return {
          rows,
          ids: registry.byCapability(logicalKyselyCapability).map((entry) => entry.key.id),
        };
      }).pipe(Effect.provide(queryRegistryLayer([
        nodeLogicalKyselyQueryFactory({ path, sourceID: "registry" }),
      ]))),
    );
    assert.deepEqual(result.rows.map((row) => ({ ...row })), [{ sessionID: "ses_registry" }]);
    assert.deepEqual(result.ids, [logicalKyselyQueryKey.id]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
