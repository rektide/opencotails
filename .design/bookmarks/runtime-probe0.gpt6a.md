---
type: Experiment
title: Callable Cotail runtime probe on Node and Bun
description: Fixture execution supports an in-process Promise boundary for the first read tool instead of a speculative per-request Node helper.
resource: /.design/bookmarks/runtime-probe0.gpt6a.md
tags: [cotail, tools, runtime, bun, node, effect, sqlite]
status: draft
generated: { by: "model:openai/gpt-6-astra#xhigh", at: 2026-09-07T02:05:42Z }
stale_after: 2026-10-07
sources:
  - { resource: /.design/bookmarks/links-tools0.gpt6a.md, title: Predecessor Node-helper recommendation }
  - { resource: /.test-agent/callable-runtime/probe.ts, title: Executable scratch compatibility probe }
  - { resource: /packages/query-kysely/src/runtime/node-sqlite.ts, title: Actual source acquisition and SQLite lifecycle }
  - { resource: /packages/query-kysely/src/operations/resolve.ts, title: Actual canonical getSession operation }
---

# Callable Runtime Probe: Prefer In-Process First

## Outcome And Revised Recommendation

**All 12 bounded probe cases passed under both Node v26.6.0 and Bun 1.4.1.**
The canonical parent/child report values also matched across runtimes. No used
SQLite API incompatibility was found. Prefer a **direct in-process, plain
Promise/JSON operation boundary** for the first read tool/RPC. Do not add a
per-request Node child process on the basis of unverified Bun or Effect concerns.

The parent's successful Bun `DatabaseSync(":memory:")` check challenged the
helper recommendation in [links-tools0](/.design/bookmarks/links-tools0.gpt6a.md).
This probe goes further by calling unchanged production acquisition, `getSession`,
logical content projection, error mapping, and cleanup. Preserve that predecessor
as history; this evidence revises its runtime recommendation, not bookmark/link
semantics or the independent read/exact-write/deferred-binder split.

This was an authorized scratch experiment, **not tool implementation, deployed
plugin/RPC acceptance, or permission to access live OpenCode data**. No production
files or dependencies were changed and no OpenCode service was invoked.

## Reproduction And Receipts

Cotail baseline: jj commit `82887b0aa3f328136fe2500ac3ff2df5cd08fefa`.
The [scratch README](/.test-agent/callable-runtime/README.md) describes retained
artifacts. The [executable probe](/.test-agent/callable-runtime/probe.ts) creates
new files only beneath `.test-agent/callable-runtime/`, using the existing
[indexed fixture/profile helpers](/packages/query-kysely/test/fixtures/opencode-v2/index.ts).
SQL in the script seeds fixture state or deliberately attempts prohibited writes;
Session lookup itself calls production `getSession`, not copied SQL or CLI parsing.

Run from `/home/rektide/src/cotail`:

```sh
node --version  # v26.6.0
bun --version   # 1.4.1
node .test-agent/callable-runtime/probe.ts
bun .test-agent/callable-runtime/probe.ts
```

| Runtime | SQLite `sqlite_version()` | Final evidence |
|---|---|---|
| Node v26.6.0 | 3.53.3 | [Node report](/.test-agent/callable-runtime/node-26.6.0-0qx5ic/report.json) |
| Bun 1.4.1 | 3.53.2 | [Bun report](/.test-agent/callable-runtime/bun-1.4.1-KHVzVH/report.json) |

Probe SHA-256: `13931325f7bd8f28469e99dd8df21a591af76e25b158cffdc2fa9a91a48d47af`.
Node report SHA-256: `2913eef146c29a691eb54a4792487ae42869946458d1caec5ba9f5fbda183881`.
Bun report SHA-256: `3e298fb29303880ee512ec7fd1d59c791549077ca0d06fcb35ce595577c28598`.
Scratch scripts/results remain git-ignored; their hashes identify this run even
if later experiments revise them. Paths resolve through Cotail's `opencoattails`
checkout symlink; that spelling difference is not another tested source.

## What Actually Passed

| Case | Evidence, on both runtimes |
|---|---|
| Used statement/function APIs | `prepare`, bound `get/all`, `columns`, `iterate`, iterator `return`, deterministic three-argument `DatabaseSync.function`, `exec`, and `close` work. |
| `readOnly` independently | With `query_only=OFF`, writes still fail; fixture title is unchanged. Constructor `timeout: 37` reads back as `PRAGMA busy_timeout=37`. |
| `query_only` independently | A normally writable fixture connection rejects writes after `PRAGMA query_only=ON`. |
| Production parent/child reads | Both exact IDs return canonical observations; child retains parent ID. Production connection reports `query_only=1`; metadata reads invoke zero payload validations. Missing ID is `SessionNotFoundError`. |
| Production write/UDF/content | A forced raw UPDATE through the actual read world fails; regexp and validated user-text projection succeed; subsequent Session read still succeeds. |
| Malformed Message payload | Session metadata lookup stays valid/lazy; actual `cotail_user_message.text` projection fails with contextual `QueryExecutionError`, message `expected string`. |
| Malformed Session report | Empty slug produces the canonical `SessionReportDecodeError`, not a silently coerced report. |
| Stale physical schema | Renaming fixture `title` does not trigger acquisition-time inspection; the requested query fails at prepare with `QueryExecutionError` / `ERR_SQLITE_ERROR`. |
| Early stream termination | One-row take invokes iterator return, rolls back the read, permits a later child read, and closes the source once. |
| AbortSignal | Interrupting a live Cotail scope after a real child read runs source cleanup and rejects the Promise. |
| Missing source | `SourceOpenError`; nonexistent fixture path is not created. |
| Two Effect installations | Host Effect invokes a Cotail-owned Promise and consumes its JSON result successfully in-process. |

The production raw-write error is `QueryExecutionError`, phase `step`, code
`ERR_SQLITE_ERROR`, message `attempt to write a readonly database` on both.
Successful/error reads balance `begin`/`rollback`; ordinary scope instrumentation
and the early-stream/abort cases show one source close. This is application
lifecycle evidence, not an OS file-descriptor census or a contention benchmark.

The first probe attempts had a **probe-authoring error**, not a runtime failure:
raw `cotail_message.sourceJSON` intentionally bypasses payload validation, and
rendering its unexpected successful rows through `String(...)` failed. The
corrected case selects the actual validated user-text relation and formats
arbitrary diagnostic values safely. Only the final receipts above support the
12/12 claim.

## Effect Boundary: Versions Differ, No Incompatibility In This Test

Actual installed package resolutions were:

- Cotail: `effect@4.0.0-beta.101` in its pnpm dependencies.
- Local OpenCode plugin checkout: `effect@4.0.0-rc.112` in its Bun dependencies,
  resolved from `/home/rektide/src/opencode-term-v2/packages/plugin/package.json`.

The script loads those two installations in the same process. The host runtime
calls `Effect.promise(() => cotailPromise)`; Cotail constructs/runs its own
Effect scope internally and returns a plain JSON-round-tripped observation.
No Effect value, Layer, Context service, branded runtime schema, or native handle
crosses the boundary. This **worked on Node and Bun**. Different version strings
alone do not justify process isolation. It does not prove arbitrary cross-version
Effect value interoperability, package deduplication, or plugin bundler behavior.

## Next Minimal Executable Slice, Still Awaiting Parent Authorization

1. Add a small Cotail-owned async Session-read function, using existing trusted
   source selection and scoped `getSession`; expose plain input/result/error
   contracts and an optional AbortSignal. Keep the query runtime private to it.
2. Register `cotail_session_get` and typed `CotailRead.sessionGet` against that
   same in-process operation. Fix source configuration outside model/RPC inputs;
   support explicit children and keep unregistered identity selection-scoped.
3. Test real plugin loading and both registrations against disposable fixtures,
   including declared errors, bounded output, and cancellation/unload behavior.
   Do not first implement `src/tools/host/request.ts`, an IPC protocol, or a daemon.

The operation boundary is Promise-based; the host wrapper need not exchange
Effect values. RPC's public Promise context supplies a signal. The inspected
Promise Tool context does not expose an AbortSignal, so **host tool cancellation
propagation remains a specific integration gate**: an Effect-facing host wrapper
can wrap the Cotail Promise with its own cancellation signal without sharing
private Effect values. The present probe proves Cotail-side signal cleanup, not
that host tool/RPC cancellation already reaches it.

Retain a fixed Node helper only as a fallback if a concrete deployed-host issue
or explicitly required isolation emerges. No smallest-API adaptation is needed
for the exercised SQLite surfaces. Synchronous SQLite calls can still block the
host event loop; keep this first operation an exact finite metadata read, not an
unbounded search, and measure that concern rather than prebuilding isolation.

## Limits And Cross-References

- No loaded OpenCode plugin, actual tool invocation, RPC round-trip, installed
  service, live DB, package bundling/typecheck, or full Node/Bun matrix was tested.
- Fixture trusted-profile facts were used; profile-file decoding/discovery and
  durable catalog identity are not newly proven by this script.
- The timeout option value was checked, not real lock-wait timing. Snapshot
  concurrency, heavy-search responsiveness, large-number codecs, descriptor
  leak stress, and every capture/Message variant remain outside this bounded probe.
- [links-tools0](/.design/bookmarks/links-tools0.gpt6a.md) owns the operation/tool/RPC
  separation; only its speculative helper recommendation is revised here.
- [summary0](/.design/bookmarks/summary0.gpt6a.md) retains exact source and pending
  intent distinctions. Neither bookmarks nor the binder block this read tracer.
- `cotail-tools-read` is the next capability checkpoint, not an accepted or
  completed implementation. `cotail-tools` keeps exact writes independently gated.
