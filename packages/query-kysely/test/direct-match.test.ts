import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { all } from "../src/query/logical-query.ts";
import { sql } from "kysely";
import { literal, regex } from "../src/direct/match.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { indexedOpenCodeV2Fixture, trustedSourceProfileFacts } from "./fixtures/opencode-v2/index.ts";

async function sourceFile(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-direct-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.prepare(`insert into session_v2
    (id, project_id, slug, directory, title, version, time_created, time_updated)
    values ('ses_a', 'prj_a', 'a', '/a', 'Alpha', '2', 1, 1)`).run();
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

test("direct literal and regex values remain SQL parameters", async () => {
  const fixture = await sourceFile();
  try {
    const compiled = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
        Effect.flatMap(({ query }) => query.compile(({ db }) => db.selectFrom("cotail_document")
          .select("documentKey")
          .where((eb) => eb.and([
            literal(eb.ref("text"), "Alpha"),
            regex(eb.ref("text"), "^Al", { flags: "i" }),
          ])))),
      ),
    ));
    assert.deepEqual(compiled.parameters, ["Alpha", "^Al", "i"]);
    assert.doesNotMatch(compiled.sql, /Alpha|\^Al/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("invalid regex fails while constructing the expression", () => {
  const text = { expressionType: undefined } as never;
  assert.throws(() => regex(text, "("), /invalid direct regular expression/);
});

test("case-insensitive regex preserves JavaScript character classes and Unicode properties", async () => {
  const fixture = await sourceFile();
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
        Effect.flatMap(({ query }) => all(query, ({ db }) => db.selectNoFrom((eb) => [
          sql<number>`${regex(eb.val("A"), "\\D", { flags: "i" })}`.as("nonDigit"),
          sql<number>`${regex(eb.val("A"), "\\S", { flags: "i" })}`.as("nonSpace"),
          sql<number>`${regex(eb.val("É"), "\\p{Lu}", { flags: "i" })}`.as("unicodeLetter"),
        ]))),
      ),
    ));
    assert.deepEqual(result.map((row) => ({ ...row })), [{ nonDigit: 1, nonSpace: 1, unicodeLetter: 1 }]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
