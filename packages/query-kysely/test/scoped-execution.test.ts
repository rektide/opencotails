import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect";
import type { AnyLogicalSelect } from "../src/query/logical-query.ts";
import { all, stream } from "../src/query/logical-query.ts";
import { QueryExecutionError } from "../src/query/errors.ts";
import {
  ReadScopeClosed,
  acquireNodeOpenCodeSource,
  acquireNodeOpenCodeSourceForTest,
  type NodeSqliteTestAction,
} from "../src/runtime/node-sqlite.ts";
import { openCodeV2Fixture, trustedSourceProfileFacts } from "./fixtures/opencode-v2.ts";

async function walFixture(): Promise<{
  readonly directory: string;
  readonly path: string;
  readonly writer: DatabaseSync;
}> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-scoped-"));
  const path = join(directory, "opencode.db");
  const fixture = openCodeV2Fixture();
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();

  const writer = new DatabaseSync(path);
  writer.exec(`
    PRAGMA journal_mode = WAL;
    insert into session_v2 (
      id, project_id, slug, directory, title, version, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
      tokens_cache_write, time_created, time_updated
    ) values ('ses_scope', 'prj_scope', 'scope', '/scope', 'before', '2', 0, 0, 0, 0, 0, 0, 1, 1)
  `);
  return { directory, path, writer };
}

test("one read retains a pinned WAL snapshot and later reads get new provenance", async () => {
  const fixture = await walFixture();
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "snapshot", profile: trustedSourceProfileFacts }).pipe(
        Effect.flatMap(({ query }) => Effect.gen(function*() {
          const pinned = yield* Effect.scoped(query.openRead.pipe(Effect.flatMap((read) => Effect.gen(function*() {
            const before = yield* read.all(({ db }) => db.selectFrom("cotail_session")
              .select("title").where("sessionID", "=", "ses_scope"));
            yield* Effect.sync(() => fixture.writer.prepare(
              "update session_v2 set title = 'after', time_updated = 2 where id = 'ses_scope'",
            ).run());
            const during = yield* read.all(({ db }) => db.selectFrom("cotail_session")
              .select("title").where("sessionID", "=", "ses_scope"));
            return { before, during, provenance: read.provenance };
          }))));
          const laterRead = yield* Effect.scoped(query.openRead.pipe(Effect.flatMap((read) =>
            read.all(({ db }) => db.selectFrom("cotail_session")
              .select("title").where("sessionID", "=", "ses_scope")).pipe(
                Effect.map((rows) => ({ rows, provenance: read.provenance })),
              ))));
          return { pinned, laterRead };
        })),
      ),
    ));

    assert.equal(result.pinned.before[0]?.title, "before");
    assert.equal(result.pinned.during[0]?.title, "before");
    assert.equal(result.laterRead.rows[0]?.title, "after");
    assert.notEqual(result.pinned.provenance.readScopeID, result.laterRead.provenance.readScopeID);
    assert.ok(result.pinned.provenance.observedAt > 0);
  } finally {
    fixture.writer.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("statement state rejects overlap, releases after streams, and detects closed reads", async () => {
  const fixture = await walFixture();
  const actions: NodeSqliteTestAction[] = [];
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSourceForTest(
        { path: fixture.path, sourceID: "state", profile: trustedSourceProfileFacts },
        (action) => actions.push(action),
      ).pipe(
        Effect.flatMap(({ query }) => Effect.gen(function*() {
          const readResult = yield* Effect.scoped(query.openRead.pipe(Effect.flatMap((read) => Effect.gen(function*() {
            let builds = 0;
            const neverConsumed = read.stream(({ db }) => {
              builds++;
              return db.selectFrom("cotail_session").select("sessionID");
            });
            assert.equal(builds, 0);
            yield* read.all(({ db }) => db.selectFrom("cotail_session").select("sessionID"));
            assert.equal(builds, 0);
            void neverConsumed;

            let overlap: QueryExecutionError | undefined;
            const rows = yield* read.stream(({ db }) => db.selectFrom("cotail_session").select("sessionID")).pipe(
              Stream.tap(() => overlap === undefined
                ? read.all(({ db }) => db.selectFrom("cotail_session").select("sessionID")).pipe(
                    Effect.flip,
                    Effect.tap((error) => Effect.sync(() => {
                      if (error instanceof QueryExecutionError) overlap = error;
                    })),
                    Effect.asVoid,
                  )
                : Effect.void),
              Stream.runCollect,
            );
            const empty = yield* read.stream(({ db }) => db.selectFrom("cotail_session")
              .select("sessionID").where("sessionID", "=", "missing")).pipe(Stream.runCollect);
            const after = yield* read.all(({ db }) => db.selectFrom("cotail_session").select("sessionID"));
            return { rows: Array.from(rows), empty: Array.from(empty), after, overlap };
          }))));

          const leaked = yield* Effect.scoped(query.openRead);
          const preparesBeforeClosedUse = actions.filter((action) => action === "prepare").length;
          const closedExit = yield* Effect.exit(leaked.all(({ db }) =>
            db.selectFrom("cotail_session").select("sessionID")));
          const leakedStream = yield* Effect.scoped(query.openRead.pipe(Effect.map((read) =>
            read.stream(({ db }) => db.selectFrom("cotail_session").select("sessionID")))));
          const leakedStreamExit = yield* Effect.exit(Stream.runCollect(leakedStream));
          const closedPrepareCount = actions.filter((action) => action === "prepare").length - preparesBeforeClosedUse;
          return { readResult, closedExit, leakedStreamExit, closedPrepareCount };
        })),
      ),
    ));

    assert.ok(result.readResult.rows.length > 0);
    assert.deepEqual(result.readResult.empty, []);
    assert.ok(result.readResult.after.length > 0);
    assert.equal(result.readResult.overlap?.reason, "read-scope-busy");
    assert(Exit.isFailure(result.closedExit));
    assert(Cause.squash(result.closedExit.cause) instanceof ReadScopeClosed);
    assert(Exit.isFailure(result.leakedStreamExit));
    assert(Cause.squash(result.leakedStreamExit.cause) instanceof ReadScopeClosed);
    assert.equal(result.closedPrepareCount, 0);
  } finally {
    fixture.writer.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("raw writes fail with retained SQLite context and the scope remains usable", async () => {
  const fixture = await walFixture();
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "readonly", profile: trustedSourceProfileFacts }).pipe(
        Effect.flatMap(({ query }) => query.openRead.pipe(Effect.flatMap((read) => Effect.gen(function*() {
          const failure = yield* read.all(() => ({
            compile: () => ({
              sql: `with selected(id) as (select 'ses_scope')
                update session_v2 set title = 'mutated'
                where id in (select id from selected) returning id`,
              parameters: [],
            }),
          }) as unknown as AnyLogicalSelect).pipe(Effect.flip);
          const rows = yield* read.all(({ db }) => db.selectFrom("cotail_session")
            .select("title").where("sessionID", "=", "ses_scope"));
          return { failure, rows };
        }))),
      )),
    ));

    assert(result.failure instanceof QueryExecutionError);
    assert.equal(result.failure.source.sourceID, "readonly");
    assert.ok(result.failure.phase === "prepare" || result.failure.phase === "step");
    assert.equal(result.failure.reason, "sqlite");
    assert.ok(result.failure.cause instanceof Error);
    assert.equal(result.rows[0]?.title, "before");
  } finally {
    fixture.writer.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("scope-owning stream closes its read after early termination", async () => {
  const fixture = await walFixture();
  const actions: NodeSqliteTestAction[] = [];
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSourceForTest(
        { path: fixture.path, sourceID: "stream", profile: trustedSourceProfileFacts },
        (action) => actions.push(action),
      ).pipe(
        Effect.flatMap(({ query }) => Effect.gen(function*() {
          const first = yield* stream(query, ({ db }) => db.selectFrom("cotail_session")
            .select("sessionID").orderBy("sessionID")).pipe(Stream.take(1), Stream.runCollect);
          const firstStepCount = actions.filter((action) => action === "step").length;
          const after = yield* all(query, ({ db }) => db.selectFrom("cotail_session").select("sessionID"));
          return { first: Array.from(first), firstStepCount, after };
        })),
      ),
    ));
    assert.equal(result.first.length, 1);
    assert.equal(result.firstStepCount, 1);
    assert.ok(result.after.length > 0);
    assert.equal(actions.filter((action) => action === "iterator-return").length, 1);
    assert.equal(actions.at(-1), "close");
  } finally {
    fixture.writer.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("waiting read interruption does not strand the source lease", async () => {
  const fixture = await walFixture();
  const actions: NodeSqliteTestAction[] = [];
  try {
    const rows = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSourceForTest(
        { path: fixture.path, sourceID: "interrupt", profile: trustedSourceProfileFacts },
        (action) => actions.push(action),
      ).pipe(
        Effect.flatMap(({ query }) => Effect.gen(function*() {
          yield* Effect.scoped(query.openRead.pipe(Effect.flatMap(() => Effect.gen(function*() {
            const waiting = yield* Effect.forkChild(Effect.scoped(query.openRead));
            yield* Effect.yieldNow;
            yield* Fiber.interrupt(waiting);
          }))));
          const beginCount = actions.filter((action) => action === "begin").length;
          const concurrentBegins = yield* Effect.scoped(query.openRead.pipe(Effect.flatMap(() => Effect.gen(function*() {
            const waiting = yield* Effect.forkChild(Effect.scoped(query.openRead));
            yield* Effect.yieldNow;
            const count = actions.filter((action) => action === "begin").length - beginCount;
            yield* Fiber.interrupt(waiting);
            return count;
          }))));
          assert.equal(concurrentBegins, 1);
          return yield* all(query, ({ db }) => db.selectFrom("cotail_session").select("sessionID"));
        })),
      ),
    ));
    assert.ok(rows.length > 0);
  } finally {
    fixture.writer.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("stream stepping failure releases its iterator and statement slot", async () => {
  const fixture = await walFixture();
  const actions: NodeSqliteTestAction[] = [];
  try {
    const result = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSourceForTest(
        { path: fixture.path, sourceID: "stream-failure", profile: trustedSourceProfileFacts },
        (action) => actions.push(action),
      ).pipe(
        Effect.flatMap(({ query }) => query.openRead.pipe(Effect.flatMap((read) => Effect.gen(function*() {
          const failure = yield* read.stream(({ db }) => db.selectNoFrom((eb) => [
            eb.fn("regexp", [eb.val("["), eb.val("value"), eb.val("")]).as("matched"),
          ])).pipe(Stream.runCollect, Effect.flip);
          const rows = yield* read.all(({ db }) => db.selectFrom("cotail_session").select("sessionID"));
          return { failure, rows };
        }))),
      )),
    ));
    assert(result.failure instanceof QueryExecutionError);
    assert.equal(result.failure.phase, "step");
    assert.ok(result.rows.length > 0);
    assert.equal(actions.filter((action) => action === "iterator-return").length, 1);
  } finally {
    fixture.writer.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("stream interruption between pulls closes the iterator and read scope", async () => {
  const fixture = await walFixture();
  const actions: NodeSqliteTestAction[] = [];
  try {
    const rows = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSourceForTest(
        { path: fixture.path, sourceID: "stream-interrupt", profile: trustedSourceProfileFacts },
        (action) => actions.push(action),
      ).pipe(Effect.flatMap(({ query }) => Effect.gen(function*() {
        const pulled = yield* Deferred.make<void>();
        const consuming = yield* Effect.forkChild(stream(query, ({ db }) => db.selectFrom("cotail_session")
          .select("sessionID")).pipe(
            Stream.tap(() => Effect.gen(function*() {
              yield* Deferred.succeed(pulled, undefined);
              yield* Effect.never;
            })),
            Stream.runDrain,
          ));
        yield* Deferred.await(pulled);
        yield* Fiber.interrupt(consuming);
        return yield* all(query, ({ db }) => db.selectFrom("cotail_session").select("sessionID"));
      }))),
    ));
    assert.equal(actions.filter((action) => action === "iterator-return").length, 1);
    assert.ok(rows.length > 0);
  } finally {
    fixture.writer.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
