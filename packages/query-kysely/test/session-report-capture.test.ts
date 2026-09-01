import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect } from "effect";
import {
  decodeSessionReportCapture,
  SessionReportCaptureDecodeError,
  sessionReportCapture,
  sessionReportCaptureSchema,
} from "../src/domain/session-report-capture.ts";
import { sessionAddress, sourceKey, target } from "../src/domain/address.ts";
import { sessionID } from "../src/domain/identifier.ts";
import { observation, ReadScopeID, readProvenance } from "../src/domain/observation.ts";
import type { SessionReport } from "../src/domain/session-report.ts";
import { captureSessionReport } from "../src/operations/capture.ts";
import { SessionNotFoundError } from "../src/operations/resolve.ts";
import { acquireNodeOpenCodeSource } from "../src/runtime/node-sqlite.ts";
import { indexedOpenCodeV2Fixture, trustedSourceProfileFacts } from "./fixtures/opencode-v2/index.ts";

interface CaptureFixture {
  readonly directory: string;
  readonly path: string;
}

async function captureFixture(updatedAt: number): Promise<CaptureFixture> {
  const directory = await mkdtemp(join(tmpdir(), "cotail-capture-"));
  const path = join(directory, "source.db");
  const fixture = indexedOpenCodeV2Fixture();
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
      'ses_capture', 'prj_capture', 'wsp_capture', 'ses_parent', 'ses_fork', ?,
      'capture', '/work/capture', 'packages/capture', 'Capture title', '2.5',
      'https://example.test/share', 11, 7, 3, ?, ?,
      ?, 9007199254740991, 20400, 944, 1320000, 9, ?, ?, 'review', ?,
      100, ?, 150, 300, 175
    )
  `).run(
    JSON.stringify({ type: "through", messageID: "msg_boundary" }),
    JSON.stringify([{ file: "a.ts" }]),
    JSON.stringify({ private: true }),
    0.1 + 0.2,
    JSON.stringify({ messageID: "msg_revert" }),
    JSON.stringify([{ permission: "read" }]),
    JSON.stringify({ id: "model", providerID: "provider", variant: "high" }),
    updatedAt,
  );
  fixture.database.exec(`
    insert into session_v2
      (id, project_id, slug, directory, title, version, time_created, time_updated)
    values ('ses_nulls', 'prj_nulls', 'nulls', '/work/nulls', null, '2.5', 0, 0)
  `);
  fixture.database.prepare("vacuum into ?").run(path);
  fixture.database.close();
  return { directory, path };
}

function withQuery<A>(path: string, run: (query: Parameters<typeof captureSessionReport>[0]) => Effect.Effect<A, unknown>) {
  return Effect.runPromise(Effect.scoped(
    acquireNodeOpenCodeSource({ path, sourceID: "fixture", profile: trustedSourceProfileFacts }).pipe(
      Effect.flatMap(({ query }) => run(query)),
    ),
  ));
}

test("captures the canonical Session observation as a frozen durable value", async () => {
  const fixture = await captureFixture(200);
  try {
    const capture = await withQuery(fixture.path, (query) => captureSessionReport(query, sessionID("ses_capture")));

    assert.equal(capture.schema, sessionReportCaptureSchema);
    assert.deepEqual(capture.target, {
      source: { kind: "opencode-v2", sourceID: "fixture" },
      address: { kind: "session", sessionID: "ses_capture" },
    });
    assert.deepEqual(capture.report, {
      title: "Capture title",
      slug: "capture",
      location: {
        projectID: "prj_capture",
        workspaceID: "wsp_capture",
        directory: "/work/capture",
        path: "packages/capture",
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
        cost: 0.1 + 0.2,
        tokens: {
          input: 9007199254740991,
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
    } satisfies SessionReport);
    assert.deepEqual(capture.guard, { updatedAt: 200 });
    assert.equal(capture.guard.updatedAt, capture.report.lifecycle.updatedAt);
    assert.equal(Number.isSafeInteger(capture.capturedAt) && capture.capturedAt >= 0, true);

    assert.equal("read" in capture, false);
    assert.equal("readScopeID" in capture, false);
    assert.equal(Object.isFrozen(capture), true);
    assert.equal(Object.isFrozen(capture.guard), true);
    assert.equal(Object.isFrozen(capture.report), false);

    await assert.rejects(
      withQuery(fixture.path, (query) => captureSessionReport(query, sessionID("ses_absent"))),
      (error: unknown) => error instanceof SessionNotFoundError,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("round-trips the wire value through JSON with exact nulls and precision", async () => {
  const fixture = await captureFixture(200);
  try {
    for (const id of ["ses_capture", "ses_nulls"]) {
      const capture = await withQuery(fixture.path, (query) => captureSessionReport(query, sessionID(id)));
      const wire: unknown = JSON.parse(JSON.stringify(capture));
      assert.equal("read" in (wire as object), false);
      const restored = decodeSessionReportCapture(wire);
      assert.deepEqual(restored, capture);
      assert.deepEqual(restored.guard, capture.guard);
    }

    const capture = await withQuery(fixture.path, (query) => captureSessionReport(query, sessionID("ses_capture")));
    assert.equal(capture.report.usage.cost === 0.1 + 0.2, true);
    assert.equal(capture.report.usage.tokens.input, Number.MAX_SAFE_INTEGER);
    const restored = decodeSessionReportCapture(JSON.parse(JSON.stringify(capture)));
    assert.equal(restored.report.usage.cost === capture.report.usage.cost, true);
    assert.equal(restored.report.usage.tokens.input, Number.MAX_SAFE_INTEGER);
    assert.equal(Object.isFrozen(restored), true);
    assert.equal(Object.isFrozen(restored.guard), true);
    assert.equal(Object.isFrozen(restored.report), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("records observation time as capturedAt and derives the guard from lifecycle", () => {
  const report: SessionReport = {
    title: null,
    slug: "observed",
    location: { projectID: "prj", workspaceID: null, directory: "/work", path: null },
    lineage: { parentSessionID: null, forkSessionID: null, forkBoundary: null },
    run: { version: "2.5", agent: null, model: null },
    usage: { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    summary: { additions: null, deletions: null, files: null },
    shareURL: null,
    lifecycle: {
      createdAt: 5,
      updatedAt: 777,
      compactingAt: null,
      archivedAt: null,
      suspendedAt: null,
    },
  };
  const observed = observation({
    target: target(sourceKey("fixture"), sessionAddress(sessionID("ses_observed"))),
    value: report,
    read: readProvenance(ReadScopeID.make("scope-capture"), 1712345678999),
  });

  const capture = sessionReportCapture(observed);
  assert.equal(capture.schema, sessionReportCaptureSchema);
  assert.equal(capture.capturedAt, 1712345678999);
  assert.deepEqual(capture.guard, { updatedAt: 777 });
  assert.deepEqual(capture.report, report);
  assert.equal(Object.isFrozen(capture) && Object.isFrozen(capture.guard), true);
});

test("does not freeze or otherwise mutate the borrowed observation", () => {
  const report: SessionReport = {
    title: null,
    slug: "borrowed",
    location: { projectID: "prj", workspaceID: null, directory: "/work", path: null },
    lineage: { parentSessionID: null, forkSessionID: null, forkBoundary: null },
    run: { version: "2.5", agent: null, model: null },
    usage: { cost: 1, tokens: { input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } } },
    summary: { additions: null, deletions: null, files: null },
    shareURL: null,
    lifecycle: {
      createdAt: 5,
      updatedAt: 777,
      compactingAt: null,
      archivedAt: null,
      suspendedAt: null,
    },
  };
  const observedTarget = target(sourceKey("fixture"), sessionAddress(sessionID("ses_borrowed")));
  const observed = observation({
    target: observedTarget,
    value: report,
    read: readProvenance(ReadScopeID.make("scope-borrowed"), 42),
  });
  const mutableLifecycle = report.lifecycle as { updatedAt: number };

  const frozenStateBefore = [
    Object.isFrozen(observed),
    Object.isFrozen(observedTarget),
    Object.isFrozen(observedTarget.address),
    Object.isFrozen(observed.value),
    Object.isFrozen(report),
    Object.isFrozen(report.lifecycle),
    Object.isFrozen(report.usage),
    Object.isFrozen(report.usage.tokens),
    Object.isFrozen(report.usage.tokens.cache),
  ];

  const capture = sessionReportCapture(observed);

  assert.deepEqual([
    Object.isFrozen(observed),
    Object.isFrozen(observedTarget),
    Object.isFrozen(observedTarget.address),
    Object.isFrozen(observed.value),
    Object.isFrozen(report),
    Object.isFrozen(report.lifecycle),
    Object.isFrozen(report.usage),
    Object.isFrozen(report.usage.tokens),
    Object.isFrozen(report.usage.tokens.cache),
  ], frozenStateBefore);
  assert.deepEqual(frozenStateBefore.slice(3), [
    false, false, false, false, false, false,
  ], "decoder-fresh report facets must start unfrozen so the test is meaningful");

  assert.equal(capture.target, observedTarget);
  assert.equal(capture.report, report);

  mutableLifecycle.updatedAt = 888;
  assert.equal(report.lifecycle.updatedAt, 888, "borrowed report stays writable after capture");
  assert.equal(capture.guard.updatedAt, 777, "guard is an independent copy, not a reference");

  // Construction must also tolerate an already-frozen observation.
  const frozenReport = Object.freeze(structuredClone(report));
  const frozenObserved = observation({
    target: observedTarget,
    value: frozenReport,
    read: readProvenance(ReadScopeID.make("scope-frozen"), 43),
  });
  const frozenCapture = sessionReportCapture(frozenObserved);
  assert.equal(frozenCapture.guard.updatedAt, frozenReport.lifecycle.updatedAt);
  assert.equal(Object.isFrozen(frozenReport), true);
});

test("tracks changed guard inputs when the Session is recaptured", async () => {
  const initial = await captureFixture(200);
  const changed = await captureFixture(999);
  try {
    const before = await withQuery(initial.path, (query) => captureSessionReport(query, sessionID("ses_capture")));
    const after = await withQuery(changed.path, (query) => captureSessionReport(query, sessionID("ses_capture")));

    assert.equal(before.guard.updatedAt, 200);
    assert.equal(after.guard.updatedAt, 999);
    assert.equal(after.guard.updatedAt, after.report.lifecycle.updatedAt);
    assert.equal(after.capturedAt >= before.capturedAt, true);

    const restored = decodeSessionReportCapture(JSON.parse(JSON.stringify(after)));
    assert.deepEqual(restored.guard, { updatedAt: 999 });
  } finally {
    await rm(initial.directory, { recursive: true, force: true });
    await rm(changed.directory, { recursive: true, force: true });
  }
});

function without(value: object, key: string): unknown {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key];
  return copy;
}

test("rejects malformed and unknown capture schemas honestly", async () => {
  const fixture = await captureFixture(200);
  try {
    const capture = await withQuery(fixture.path, (query) => captureSessionReport(query, sessionID("ses_capture")));
    const wire = JSON.parse(JSON.stringify(capture)) as Record<string, any>;
    const report = wire.report as Record<string, any>;
    const location = report.location as Record<string, any>;
    const usage = report.usage as Record<string, any>;
    const tokens = usage.tokens as Record<string, any>;

    const cases: readonly (readonly [name: string, input: unknown])[] = [
      ["unknown schema version", { ...wire, schema: "cotail.session-report.capture/v2" }],
      ["unrelated schema", { ...wire, schema: "cotail.bookmark/v9" }],
      ["missing schema", without(wire, "schema")],
      ["missing guard", without(wire, "guard")],
      ["missing capturedAt", without(wire, "capturedAt")],
      ["string capturedAt", { ...wire, capturedAt: "1712345678999" }],
      ["fractional capturedAt", { ...wire, capturedAt: 1.5 }],
      ["negative guard", { ...wire, guard: { updatedAt: -1 } }],
      ["string guard", { ...wire, guard: { updatedAt: "200" } }],
      ["string cost", { ...wire, report: { ...report, usage: { ...usage, cost: "1.25" } } }],
      ["negative cost", { ...wire, report: { ...report, usage: { ...usage, cost: -0.5 } } }],
      ["NaN cost", { ...wire, report: { ...report, usage: { ...usage, cost: Number.NaN } } }],
      ["infinite cost", { ...wire, report: { ...report, usage: { ...usage, cost: Number.POSITIVE_INFINITY } } }],
      ["negative infinite cost", { ...wire, report: { ...report, usage: { ...usage, cost: Number.NEGATIVE_INFINITY } } }],
      ["NaN guard", { ...wire, guard: { updatedAt: Number.NaN } }],
      ["undefined input", undefined],
      ["nested excess in token cache", { ...wire, report: { ...report, usage: { ...usage, tokens: { ...tokens, cache: { read: 1320000, write: 9, readScopeID: "scope-capture" } } } } }],
      ["nested excess in source key", { ...wire, target: { source: { ...wire.target.source, revision: 1 }, address: wire.target.address } }],
      ["blank slug", { ...wire, report: { ...report, slug: " " } }],
      ["fractional tokens", { ...wire, report: { ...report, usage: { ...usage, tokens: { ...tokens, input: 1.5 } } } }],
      ["negative summary", { ...wire, report: { ...report, summary: { additions: -1, deletions: null, files: null } } }],
      ["null slug", { ...wire, report: { ...report, slug: null } }],
      ["blank workspace id", { ...wire, report: { ...report, location: { ...location, workspaceID: " " } } }],
      ["empty session id", { ...wire, target: { source: wire.target.source, address: { kind: "session", sessionID: "" } } }],
      ["non-session address", { ...wire, target: { source: wire.target.source, address: { kind: "message", sessionID: "ses_capture", messageID: "msg_1" } } }],
      ["legacy source kind", { ...wire, target: { source: { kind: "opencode-v1", sourceID: "fixture" }, address: wire.target.address } }],
      ["null input", null],
      ["string input", "capture"],
      ["number input", 7],
      ["array input", [wire]],
    ];

    for (const [name, input] of cases) {
      assert.throws(() => decodeSessionReportCapture(input), (error: unknown) =>
        error instanceof SessionReportCaptureDecodeError, `${name} must be rejected`);
    }

    let thrown: unknown = undefined;
    try {
      decodeSessionReportCapture({ ...wire, schema: "cotail.session-report.capture/v2" });
      assert.fail("unknown schema version must throw");
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof SessionReportCaptureDecodeError);
    assert.equal(thrown.observedSchema, "cotail.session-report.capture/v2");
    assert.match(thrown.message, /v2/);

    try {
      decodeSessionReportCapture(null);
      assert.fail("null input must throw");
    } catch (error) {
      assert.ok(error instanceof SessionReportCaptureDecodeError);
      assert.equal(error.observedSchema, null);
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects smuggled provenance and expansion keys in the wire value", async () => {
  const fixture = await captureFixture(200);
  try {
    const capture = await withQuery(fixture.path, (query) => captureSessionReport(query, sessionID("ses_capture")));
    const wire = JSON.parse(JSON.stringify(capture)) as Record<string, any>;
    const report = wire.report as Record<string, any>;

    const cases: readonly (readonly [name: string, input: unknown])[] = [
      ["read provenance", { ...wire, read: { readScopeID: "scope-capture", observedAt: 1 } }],
      ["bare readScopeID", { ...wire, readScopeID: "scope-capture" }],
      ["read-scope guard", { ...wire, guard: { updatedAt: 200, readScopeID: "scope-capture" } }],
      ["report read provenance", { ...wire, report: { ...report, read: { readScopeID: "scope-capture", observedAt: 1 } } }],
      ["transcript expansion", { ...wire, transcript: [] }],
      ["evidence expansion", { ...wire, evidence: [] }],
      ["lineage tree expansion", { ...wire, lineageTree: { children: [] } }],
      ["target revision", { ...wire, target: { ...wire.target, revision: { messageUpdatedAt: 1, payloadHash: "deadbeef" } } }],
    ];

    for (const [name, input] of cases) {
      assert.throws(() => decodeSessionReportCapture(input), (error: unknown) =>
        error instanceof SessionReportCaptureDecodeError, `${name} must be rejected`);
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("accepts blank nullable text where the canonical decoder allows it", async () => {
  const fixture = await captureFixture(200);
  try {
    const capture = await withQuery(fixture.path, (query) => captureSessionReport(query, sessionID("ses_capture")));
    const wire = JSON.parse(JSON.stringify(capture)) as Record<string, any>;
    const report = wire.report as Record<string, any>;

    const blanks: Record<string, any> = structuredClone(report);
    blanks.title = "";
    blanks.shareURL = "";
    blanks.location.path = "";
    blanks.run.agent = "";
    blanks.run.model = "";
    blanks.lineage.forkBoundary = "";
    const decoded = decodeSessionReportCapture({ ...wire, report: blanks });
    assert.equal(decoded.report.title, "");
    assert.equal(decoded.report.location.path, "");
    assert.equal(decoded.report.run.agent, "");
    assert.equal(decoded.report.run.model, "");
    assert.equal(decoded.report.shareURL, "");
    assert.equal(decoded.report.lineage.forkBoundary, "");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("keeps the guard independent of report lifecycle on the wire", async () => {
  const fixture = await captureFixture(200);
  try {
    const capture = await withQuery(fixture.path, (query) => captureSessionReport(query, sessionID("ses_capture")));
    const wire = JSON.parse(JSON.stringify(capture)) as Record<string, any>;

    // The guard is the comparison token, not a duplicate of lifecycle: v1
    // decodes captures whose guard has drifted (for example an older capture
    // re-serialized alongside a newer report) and leaves comparison semantics
    // to bookmark resolution.
    const decoded = decodeSessionReportCapture({ ...wire, guard: { updatedAt: 999 } });
    assert.equal(decoded.guard.updatedAt, 999);
    assert.equal(decoded.report.lifecycle.updatedAt, 200);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
