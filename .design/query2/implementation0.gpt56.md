---
type: ImplementationReport
title: Cotail standalone query execution implementation
description: Implementation record for the scoped node:sqlite query architecture.
resource: /.design/query2/implementation0.gpt56.md
tags: [cotail, query, execution, effect, sqlite, streaming]
status: stable
generated: { by: model:openai/gpt-5.6, at: 2026-08-20T00:00:00Z }
verified: { by: model:openai/gpt-5.6, at: 2026-08-20T00:00:00Z }
stale_after: 2026-11-20
sources:
  - id: scoped-query-design
    resource: /.design/query2/design2.gpt56.md
    title: Cotail standalone query execution
  - id: scoped-query-implementation
    resource: /packages/query-kysely/src/runtime/node-sqlite.ts
    title: Scoped node:sqlite execution implementation
  - id: scoped-query-tests
    resource: /packages/query-kysely/test/scoped-execution.test.ts
    title: Scoped execution behavioral suite
---

# Cotail Standalone Query Execution Implementation

## Scope

This report tracks implementation of Cuts 1 and 2 from the
[standalone query execution design](/.design/query2/design2.gpt56.md): a scoped
read transaction, truthful read provenance, buffered and explained queries,
lazy streaming, direct caller migration, and behavioral tests. Operational
polish remains outside the implementation unless needed to verify the resource
model.

Tracked work: `cotail-query-read-scope`.

## Baseline

Before implementation, the repository passed:

- 13 root CLI integration tests;
- 46 `@opencoattails/query-kysely` tests;
- 6 `@opencoattails/query-runtime` tests; and
- TypeScript checks for both packages.

The working copy began empty at commit `a4ba1765` (`Clarify closed read scope
failure`).

## Implementation Log

Commit `ef8f5050` replaced stateless execution with the scoped implementation:

- `LogicalQueryShape.openRead` acquires an exclusive source lease, starts a
  deferred transaction, pins it with a `sqlite_schema` read, and publishes
  provenance only after that pin succeeds.
- `LogicalRead.all`, `explain`, and `stream` share one runtime statement slot.
  Closed reads die with `ReadScopeClosed`; overlap fails with the checked
  `read-scope-busy` reason.
- The convenience `all` and `stream` functions own read scopes for ordinary
  single-statement use.
- Streaming uses a scoped native iterator and one `next()` call per Effect
  stream pull. Its finalizer invokes `return()` on completion, failure, and
  early termination.
- Direct search now attaches execution-minted `ReadProvenance`; history and
  resolve use the buffered scope-owning helper.
- The node source now uses a 5,000 ms default native busy timeout. The documented
  Node minimum was raised to 24 because that option was introduced in Node 24.
- Native adapter classes and source inspection were removed from package-root
  exports. Deep relative imports remain available to package-owned tests.
- A deep-test-only action hook observes lifecycle events without adding a
  provider abstraction or public package-root surface.

The implementation kept `LogicalQueryShape` as the interface name because the
existing Effect service already owns the `LogicalQuery` name. This is a naming
deviation only; the external operation seam matches the design.

## Design Conformance

The implementation satisfies the principal success criteria:

- Kysely compiles typed logical selects but no longer delegates execution to a
  stateless SQL executor.
- A WAL concurrency test proves stable multi-statement snapshots and visibility
  from a later read scope.
- Read observations carry one execution-minted scope ID and observation time.
- Buffered, explained, and streamed statements use one busy/closed state
  mechanism.
- Native read-only mode and `query_only` reject a cast raw `UPDATE ... RETURNING`
  without a handwritten SQL classifier.
- Compiled SQL and copied parameters remain explicit diagnostics; execution
  failures retain source, phase, reason, native code when present, and cause.
- Package-root exports contain no `DatabaseSync` or `StatementSync` values.
- Existing CLI behavior remains unchanged under characterization tests.

The suite directly observes rollback after an injected pin failure, one pull
for `take(1)`, empty-stream cleanup, exact iterator-return counts after early
termination, stepping failure, and interruption between pulls, no prepare after
closure or leaked-stream consumption, and source close after stream/read
cleanup. The interrupted-waiter test also holds a later read while checking that
a concurrent waiter cannot reach native `BEGIN`, detecting an accidentally
released extra permit.

Operational spans, fingerprints, benchmarks, deadlines, pooling, and a hosted
provider remain intentionally deferred as specified.

## Verification

Verification on Node `26.6.0`:

- `pnpm --filter @opencoattails/query-kysely check`: 54 tests and strict
  TypeScript checking passed after lifecycle instrumentation was added.
- `pnpm --filter @opencoattails/query-runtime test`: 6 tests passed.
- `pnpm --filter @opencoattails/query-runtime typecheck`: passed.
- `pnpm test`: 13 CLI and Arrow characterization tests passed.
- An independent standards/spec review identified lifecycle observability and
  report completeness gaps; the report was completed and native action hooks
  were added in response.

The supported minimum is Node 24, but this workspace only provided Node 26.6.0.
Cross-version verification of native iterator `return()` remains tracked as
`cotail-query-read-scope-node-matrix`; the implementation does not claim that
matrix has run locally.

## Cross-References

- [The standalone query execution design](/.design/query2/design2.gpt56.md)
  defines the target contracts, lifecycle semantics, and required behavioral
  suite.
- [The original execution contract](/.design/query2/design.md) is the broader
  provider-oriented design superseded for this implementation.
- [The V2 relational query world](/.design/query/design3.gpt56.md) defines the
  logical relations consumed by the execution module.
