import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import {
  decodeSessionReport,
  SessionReportDecodeError,
  sessionReportQuery,
} from "../src/operations/session-report.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { openCodeV2Fixture } from "./fixtures/opencode-v2.ts";

async function reportFixture(): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-session-report-"));
  const path = join(directory, "source.db");
  const fixture = openCodeV2Fixture();
  fixture.completeMigration();
  fixture.database.prepare(`
    insert into session_v2 (
      id, project_id, workspace_id, parent_id, fork_session_id, fork_boundary,
      slug, directory, path, title, version, share_url,
      summary_additions, summary_deletions, summary_files, summary_diffs, metadata,
      cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
      tokens_cache_write, revert, permission, agent, model,
      time_created, time_updated, time_compacting, time_archived, time_suspended
    ) values (
      'ses_report', 'prj_report', 'wsp_report', 'ses_parent', 'ses_fork', ?,
      'report', '/work/report', 'packages/report', 'Report title', '2.5',
      'https://example.test/share', 11, 7, 3, ?, ?,
      1.25, 1320, 20400, 944, 1320000, 9, ?, ?, 'review', ?,
      100, 200, 150, 300, 175
    )
  `).run(
    JSON.stringify({ type: "through", messageID: "msg_boundary" }),
    JSON.stringify([{ file: "a.ts" }]),
    JSON.stringify({ private: true }),
    JSON.stringify({ messageID: "msg_revert" }),
    JSON.stringify([{ permission: "read" }]),
    JSON.stringify({ id: "model", providerID: "provider", variant: "high" }),
  );
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values ('ses_null', 'prj_null', 'nulls', '/work/nulls', null, '2.5', 0, 0)
  `);
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

test("maps every canonical Session report facet into a checked observation", async () => {
  const fixture = await reportFixture();
  try {
    const { result, row } = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture" }).pipe(
        Effect.flatMap(({ query }) => query.openRead),
        Effect.flatMap((read) => read.all(({ db }) => sessionReportQuery(db)
          .where("cotail_session.sessionID", "=", "ses_report")).pipe(
          Effect.map((rows) => ({
            row: rows[0]!,
            result: decodeSessionReport(rows[0]!, read.source, read.provenance),
          })),
        )),
      ),
    ));

    assert.deepEqual(result, {
      target: {
        source: { kind: "opencode-v2", sourceID: "fixture" },
        address: { kind: "session", sessionID: "ses_report" },
      },
      value: {
        title: "Report title",
        slug: "report",
        location: {
          projectID: "prj_report",
          workspaceID: "wsp_report",
          directory: "/work/report",
          path: "packages/report",
        },
        lineage: {
          parentSessionID: "ses_parent",
          forkSessionID: "ses_fork",
          forkBoundary: JSON.stringify({ type: "through", messageID: "msg_boundary" }),
        },
        run: {
          version: "2.5",
          agent: "review",
          model: JSON.stringify({ id: "model", providerID: "provider", variant: "high" }),
        },
        usage: {
          cost: 1.25,
          tokens: {
            input: 1320,
            output: 20400,
            reasoning: 944,
            cache: { read: 1320000, write: 9 },
          },
        },
        summary: { additions: 11, deletions: 7, files: 3 },
        shareURL: "https://example.test/share",
        lifecycle: {
          createdAt: 100,
          updatedAt: 200,
          compactingAt: 150,
          archivedAt: 300,
          suspendedAt: 175,
        },
      },
      read: result.read,
    });
    assert.equal(result.read.observedAt >= 0, true);
    assert.equal(result.read.readScopeID.length > 0, true);
    assert.equal("summaryDiffsJSON" in result.value, false);
    assert.equal("metadataJSON" in result.value, false);
    assert.equal("permissionJSON" in result.value, false);
    assert.equal("revertJSON" in result.value, false);
    assert.equal("summaryDiffsJSON" in row, false);
    assert.equal("metadataJSON" in row, false);
    assert.equal("permissionJSON" in row, false);
    assert.equal("revertJSON" in row, false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("preserves null optional fields and zero-valued counters", async () => {
  const fixture = await reportFixture();
  try {
    const report = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture" }).pipe(
        Effect.flatMap(({ query }) => query.openRead),
        Effect.flatMap((read) => read.all(({ db }) => sessionReportQuery(db)
          .where("cotail_session.sessionID", "=", "ses_null")).pipe(
          Effect.map((rows) => decodeSessionReport(rows[0]!, read.source, read.provenance).value),
        )),
      ),
    ));

    assert.deepEqual(report, {
      title: null,
      slug: "nulls",
      location: {
        projectID: "prj_null", workspaceID: null, directory: "/work/nulls", path: null,
      },
      lineage: { parentSessionID: null, forkSessionID: null, forkBoundary: null },
      run: { version: "2.5", agent: null, model: null },
      usage: {
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      summary: { additions: null, deletions: null, files: null },
      shareURL: null,
      lifecycle: {
        createdAt: 0, updatedAt: 0, compactingAt: null, archivedAt: null, suspendedAt: null,
      },
    });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("keeps the canonical projection unambiguous when operations add joins", async () => {
  const fixture = await reportFixture();
  try {
    const rows = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture" }).pipe(
        Effect.flatMap(({ query }) => query.openRead),
        Effect.flatMap((read) => read.all(({ db }) => sessionReportQuery(db)
          .leftJoin("cotail_message", "cotail_message.sessionID", "cotail_session.sessionID")
          .where("cotail_session.sessionID", "=", "ses_report"))),
      ),
    ));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.sessionID, "ses_report");
    assert.equal(rows[0]!.projectID, "prj_report");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects malformed Session report rows at the decoder seam", async () => {
  const fixture = await reportFixture();
  try {
    const { row, source, read } = await Effect.runPromise(Effect.scoped(
      acquireNodeOpenCodeSource({ path: fixture.path, sourceID: "fixture" }).pipe(
        Effect.flatMap(({ query }) => query.openRead),
        Effect.flatMap((scope) => scope.all(({ db }) => sessionReportQuery(db)
          .where("cotail_session.sessionID", "=", "ses_report")).pipe(
          Effect.map((rows) => ({ row: rows[0]!, source: scope.source, read: scope.provenance })),
        )),
      ),
    ));

    for (const [field, malformed] of [
      ["sessionID", { ...row, sessionID: " " }],
      ["parentID", { ...row, parentID: " " }],
      ["tokensInput", { ...row, tokensInput: -1 }],
      ["tokensOutput", { ...row, tokensOutput: Number.MAX_SAFE_INTEGER + 1 }],
      ["summaryFiles", { ...row, summaryFiles: -1 }],
      ["cost", { ...row, cost: Number.POSITIVE_INFINITY }],
      ["cost", { ...row, cost: -1 }],
      ["updatedAt", { ...row, updatedAt: 1.5 }],
      ["title", { ...row, title: 42 }],
    ] as const) {
      assert.throws(
        () => decodeSessionReport(malformed as typeof row, source, read),
        (error: unknown) => error instanceof SessionReportDecodeError && error.field === field,
      );
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
