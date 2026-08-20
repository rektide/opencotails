---
type: ProductRequirements
title: Cotail standalone query execution
description: Revised design for a node:sqlite read scope with truthful provenance, conventional Effect scoping, buffered reads, streaming, explain diagnostics, and flexible local debugging.
resource: /.design/query2/design2.gpt56.md
tags: [cotail, query, execution, effect, sqlite, snapshot, streaming]
status: draft
generated: { by: model:openai/gpt-5.6, at: 2026-08-20T00:00:00Z }
stale_after: 2026-11-20
sources:
  - id: execution-prd
    resource: /.design/query2/design.md
    title: Original query execution contract
  - id: relational-query-world
    resource: /.design/query/design3.gpt56.md
    title: Cotail V2 relational query world
  - id: logical-query-implementation
    resource: /packages/query-kysely/src/query/logical-query.ts
    title: Current LogicalQuery implementation
  - id: node-sqlite-adapter
    resource: /packages/query-kysely/src/runtime/node-sqlite.ts
    title: Current node:sqlite adapter
---

# Cotail Standalone Query Execution

## Purpose

This document revises the [original execution contract](/.design/query2/design.md)
after assessing it against the implemented query world and current OpenCode V2.
It keeps the central move from a stateless executor to a scoped read, but narrows
the product and relaxes claims that would require disproportionate machinery.

The chosen product is a standalone, read-only query substrate over OpenCode's
local SQLite history. The implementation uses `node:sqlite`. An in-process
OpenCode host adapter is not part of this design.

The chosen Effect model is conventional scoped-resource discipline:

- a source scope owns the database handle;
- a read scope owns one lease and transaction;
- a stream scope owns one statement iterator;
- finalizers compose lexically when callers use the interfaces as intended;
- runtime state rejects use after closure or overlapping statement use; and
- the design does not claim TypeScript makes scoped values impossible to leak.

This is a local developer tool. Diagnostics should remain useful. SQL and
parameters are available through explicit compilation, native causes remain
available on failures, and `EXPLAIN` is supported. Default spans should avoid
large or content-bearing values, but redaction is not an authorization system.

## Decisions From The Revision

| Topic | Decision |
|---|---|
| Execution target | Implement standalone `node:sqlite` only. |
| Provider abstraction | Do not introduce one until a second implementation is concrete. |
| Effect lifetime | Use ordinary `Scope`, `Effect.acquireRelease`, `Semaphore`, `Stream.scoped`, and `Stream.unwrap` patterns. |
| Stream escape | Document scoped use, reject late consumption at runtime, and make the convenience stream scope-owning. |
| Snapshot | One deferred read transaction pinned by a real database read. |
| Provenance | Record a read-scope ID and observation time; do not invent source revision. |
| Explain | Preserve `EXPLAIN QUERY PLAN` and permit SQLite's non-mutating explain facilities. |
| Read-only barrier | Trust typed select construction for ordinary use and native read-only plus `query_only` for runtime enforcement. |
| Diagnostics | Favor debuggability: retain causes and explicit compiled SQL/parameters. Keep ordinary spans bounded. |
| Result immutability | TypeScript `readonly` is sufficient; do not recursively freeze returned data. |
| Compatibility | Migrate directly; do not retain `run` aliases or old observation fields. |
| Conformance | Keep a strong standalone behavioral suite; do not design a provider-author SPI. |

## Product Position

Cotail is not a replacement for OpenCode's transactional domain model. It is a
different instrument over the same local history:

- OpenCode owns creating, updating, projecting, and serving Sessions.
- Cotail owns cross-Session retrieval, logical documents, evidence, reporting,
  export, and future indexing or bookmarks.
- OpenCode may be stopped while cotail queries its database.
- Cotail accepts coupling to validated OpenCode physical schemas but presents a
  cotail-owned logical relation model to callers.

Current OpenCode V2 has a capable internal Effect SQL and Drizzle stack, but its
public plugin interface does not expose private database services. Its public
query operations do not provide cotail's arbitrary logical selection or
cross-Session document search, and its Node SQL connection does not currently
implement streaming execution. A hosted cotail implementation would therefore
be an upstream product integration, not another readily available adapter.

If OpenCode later exposes an operation-shaped extension that serves cotail's
needs, that integration should be designed at the operation seam. This design
does not reserve an internal provider interface for it.

## Goals

1. Give one statement and several statements the same execution vocabulary.
2. Keep every statement in one read scope on one connection and snapshot.
3. Attach observations to provenance minted after that snapshot is pinned.
4. Support buffered reads without exposing native SQLite resources.
5. Support bounded, lazy streaming with reliable iterator cleanup.
6. Preserve Kysely's inferred row types.
7. Make simple one-statement and one-stream callers concise.
8. Keep compilation and explain output useful for local diagnostics.
9. Distinguish expected SQLite failures without hiding their native cause.
10. Preserve current CLI behavior through direct migration and tests.

## Non-Goals

- An OpenCode-hosted execution adapter
- A general provider interface or third-party provider SPI
- A remotely serialized query protocol
- A worker-thread SQLite adapter
- Hard cancellation during a synchronous SQLite step
- Connection pooling
- Write transactions
- Runtime deep immutability
- Treating SQL text as a privileged secret inside this local library
- Source-state revisions that SQLite cannot truthfully provide
- Complete access-policy, index, or bookmark behavior

## Vocabulary

| Term | Meaning |
|---|---|
| **source scope** | The Effect scope that owns one validated read-only `DatabaseSync` and its logical query module. |
| **read scope** | One exclusive lease on that source, one pinned read transaction, and its execution state. |
| **read-scope ID** | Opaque identity for one read scope. Equality means the same scope and pinned snapshot. Inequality says nothing about whether data changed. |
| **read provenance** | The read-scope ID and time at which the pinned scope became available to cotail code. |
| **statement slot** | The read scope's single active buffered, streaming, or explain execution position. |
| **buffered read** | A select whose rows are fully copied into JavaScript values before completion. |
| **streamed read** | A select stepped lazily under downstream demand while its iterator remains acquired. |
| **observation revision** | Entity-level revision information such as Message update time and payload hash. It is not read provenance. |

## Module Shape

The external seam remains `LogicalQuery`. Its implementation directly owns the
standalone SQLite behavior. There is no `ReadExecutionProvider` interface in
this cut.

```ts
interface LogicalQuery {
  readonly openRead: Effect.Effect<LogicalRead, QueryExecutionError, Scope.Scope>

  readonly compile: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<CompiledLogicalQuery<InferResult<Q>[number]>, QueryCompileError>
}

interface LogicalRead {
  readonly source: SourceKey
  readonly capabilities: SourceCapabilities
  readonly provenance: ReadProvenance

  readonly all: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<Readonly<InferResult<Q>>, QueryError>

  readonly stream: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Stream.Stream<InferResult<Q>[number], QueryError>

  readonly explain: <const Q extends AnyLogicalSelect>(
    build: (context: QueryContext) => Q,
  ) => Effect.Effect<readonly SqliteQueryPlanRow[], QueryError>
}
```

`AnyLogicalSelect`, `QueryContext`, and inferred output behavior remain based on
the current implementation. The callback is trusted library code. TypeScript
casts and builders from another Kysely instance are not an authorization model.

### Simple buffered helper

```ts
const all = <Q extends AnyLogicalSelect>(
  query: LogicalQuery,
  build: (context: QueryContext) => Q,
) => Effect.scoped(
  query.openRead.pipe(
    Effect.flatMap((read) => read.all(build)),
  ),
)
```

### Simple streaming helper

```ts
const stream = <Q extends AnyLogicalSelect>(
  query: LogicalQuery,
  build: (context: QueryContext) => Q,
) => Stream.unwrap(
  query.openRead.pipe(
    Effect.map((read) => read.stream(build)),
  ),
)
```

These are helpers over the same implementation, not alternate execution paths.

## Effect And Lifetime Model

### Source scope

`acquireNodeOpenCodeSource` continues to use `Effect.acquireRelease` to open and
close one `DatabaseSync`. Source validation and function registration happen
before a query module is published.

The source scope creates one Effect `Semaphore` with one permit. The semaphore
serializes read scopes over the single synchronous connection.

### Read-scope acquisition

`openRead` performs these steps:

1. Wait interruptibly for the source semaphore.
2. Once acquired, register release of the permit before beginning SQLite work.
3. Execute `BEGIN DEFERRED`.
4. Register transaction cleanup before attempting the pin read.
5. Pin the snapshot with a real read from `sqlite_schema`.
6. Mint `ReadScopeID` and record `observedAt`.
7. Publish an open `LogicalRead`.

Acquisition uses `Effect.uninterruptibleMask` only around state changes that
must pair acquisition with finalizer registration. Waiting for the semaphore
and normal query execution remain interruptible at Effect boundaries.

The pin operation is an implementation detail. The initial choice is:

```sql
SELECT rootpage FROM sqlite_schema ORDER BY name LIMIT 1
```

Source validation guarantees the required schema exists, so this touches the
database after `BEGIN` without parsing Message payloads. A focused SQLite test
must prove that two statements retain the old view after a concurrent WAL
writer commits. If the test disproves this pin, select another real schema or
table read before publishing the interface; do not weaken the snapshot claim.

Read-scope release attempts `ROLLBACK`, marks the scope closed, and releases the
semaphore. Finalizer defects remain visible in the Effect Cause. Cleanup does
not need a recoverable domain error solely so an application can continue using
a connection whose state is uncertain.

### Statement state

Each read scope has this runtime state:

```ts
type ReadState = "open" | "statement-active" | "closed"
```

- `open` may acquire one statement slot.
- `statement-active` rejects another statement immediately.
- `closed` rejects all further execution.

The implementation should not queue concurrent statements inside a read scope.
Callers that need concurrency can open separate read scopes, which serialize at
the source in this implementation and do not share provenance.

`read-scope-busy` is an expected `QueryExecutionError` reason because a caller
can respond by sequencing work or opening a separate scope. Use after closure
is programmer misuse and dies with a `ReadScopeClosed` defect rather than
polluting every query's checked error channel. Tests assert that the defect is
observable and no native operation occurs after closure.

### What scoping does and does not guarantee

Correctly composed Effects cannot finish their source, read, or stream scope
without running the corresponding finalizers. The interface follows that
ordinary Effect guarantee.

TypeScript does not prevent a caller from returning `LogicalRead` or its Stream
from `Effect.scoped`. Direct `LogicalRead.stream` therefore carries the rule
that consumption belongs inside the read scope. Late consumption is detected
by runtime state and fails before preparing a statement.

The convenience `stream(query, build)` is the preferred ordinary interface. It
owns the read scope through `Stream.unwrap`, so downstream completion,
failure, or interruption closes both statement and transaction resources.

No reference counting or independently retained transaction lease is added to
make leaked streams work. That would obscure rather than strengthen lexical
resource ownership.

## Streaming Semantics

`LogicalRead.stream(build)` is lazy. Its implementation uses
`Effect.acquireRelease` for the iterator and statement slot, lifts that
acquisition into the Stream, and applies `Stream.scoped` so the finalizer runs
when stream consumption ends.

1. Constructing the Stream does not compile, reserve the statement slot, or
   create an iterator.
2. Stream acquisition checks that the read is open and reserves its slot.
3. It compiles the select, prepares the statement, binds parameters, and creates
   the native iterator.
4. Each demand performs bounded synchronous work, initially one row per pull or
   a small fixed chunk if measurements justify it.
5. Completion releases the iterator and statement slot.
6. Failure, interruption, or early downstream termination invokes
   `iterator.return()` when available, then releases the slot.
7. The surrounding read remains open for a later sequential statement.

A never-consumed Stream owns nothing. Two Streams may be constructed from one
read; whichever is consumed first reserves the slot. Attempting to consume the
second concurrently fails with `read-scope-busy`.

The standalone adapter is synchronous. Effect interruption is observed before
acquisition and between iterator pulls, not while `StatementSync` is stepping
on the JavaScript thread. Streaming never transparently restarts after emitting
rows.

The supported Node range must be tested for iterator `return()` behavior. The
current Node 26 implementation exposes it. If the minimum supported Node lacks
reliable iterator cleanup, raise the minimum version rather than relying on
garbage collection or adding a second streaming implementation.

## Provenance And Observation

### Types

Use the project's existing Effect Schema branding style:

```ts
const ReadScopeID = Schema.String.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.brand("ReadScopeID"),
)

interface ReadProvenance {
  readonly readScopeID: ReadScopeID
  readonly observedAt: number
}
```

The standalone implementation mints an opaque UUID after the transaction is
pinned. The string format is not public semantics.

Do not define `SourceRevision` yet. The standalone implementation has no truthful,
stable source-state token beyond scope identity. Absence requires no optional
field until a consumer has a concrete use for one.

### Observation shape

Replace the ambiguous flattened fields directly; no compatibility alias is
needed:

```ts
interface Observation<A extends Address, V> {
  readonly target: Target<A>
  readonly value: V
  readonly read: ReadProvenance
  readonly revision?: ProjectionRevision
}
```

`Target.source` remains the source identity. `read` records how this value was
observed. `revision` records which version of a nested entity was decoded. The
three concepts are related but not interchangeable.

Direct search opens one read, executes its select, and passes
`read.provenance` into every evidence observation. It no longer calls
`Date.now()` or `randomUUID()` itself.

## Compilation And Explain

### Compilation

Public `compile` remains an explicit diagnostic operation returning copied SQL
and parameter arrays. It does not expose a native statement or connection.

This local library does not add a capability token around compilation. Query
authors need SQL and parameters to debug query construction, SQLite plans, and
fixture disagreements. Callers remain responsible for not publishing sensitive
parameters in logs they do not control.

Execution compiles from the query callback itself. A public compiled envelope
is not accepted as an execution input, avoiding a second raw-SQL execution
interface without pretending the distinction is a security boundary.

### Explain

`LogicalRead.explain` prefixes the compiled logical select with
`EXPLAIN QUERY PLAN` and executes it on the same read scope. It reserves the
same statement slot and returns SQLite plan rows.

There is no requirement to reject `EXPLAIN INSERT` as intrinsically dangerous.
SQLite explain facilities inspect bytecode or plans without performing the
underlying mutation. Ordinary `LogicalRead.explain` receives a select builder;
trusted raw diagnostics may use SQLite's explain behavior when deliberately
added or exercised in tests.

Do not make a handwritten SQL-token classifier the main read-only barrier. It
is difficult to make complete and can block useful SQLite diagnostics. The
standalone barriers are:

1. `ReadonlyQueryCreator<CotailRelations>` for normal query construction.
2. A logical interface accepting selects.
3. `DatabaseSync(..., { readOnly: true })`.
4. `PRAGMA query_only = ON`.

Tests must prove that actual writes fail, including writes hidden in CTEs or raw
builders. They need not prove that non-mutating explanations of writes fail.

## Buffered Result Contract

`LogicalRead.all` returns after `StatementSync.all()` has materialized ordinary
JavaScript rows. No statement, iterator, native result view, or connection
escapes.

The public type is readonly. The runtime array and row objects are not frozen.
This matches Kysely and JavaScript expectations, avoids recursive-copy policy,
and keeps the contract focused on provider-resource ownership rather than
general object immutability.

## Failure Model

Keep separate compile and execution failures, but favor useful context over an
exhaustive closed taxonomy.

```ts
type QueryExecutionPhase =
  | "begin"
  | "pin"
  | "prepare"
  | "step"
  | "explain"

type QueryExecutionReason =
  | "sqlite"
  | "busy"
  | "locked"
  | "read-scope-busy"

interface QueryExecutionFailure {
  readonly source: SourceKey
  readonly phase: QueryExecutionPhase
  readonly reason: QueryExecutionReason
  readonly message: string
  readonly code?: string
  readonly cause?: unknown
}
```

The exact Schema class may evolve while implementing against Node's actual
SQLite error shape. Preserve a string `code` when Node supplies one; do not
create an exhaustive code enum. Preserve the cause for local debugging.

Compilation failures may likewise retain their cause. Domain row decoding
remains operation-owned and is not folded into execution failure.

Rollback, iterator-return, handle-close, and semaphore-release defects occur in
finalizers. They remain defects in the Effect Cause rather than pretending the
resource is safely reusable after cleanup failed.

Effect interruption also remains interruption in the Effect Cause. Do not map
it into a checked `QueryExecutionError`; doing so would discard Effect's normal
interruption semantics.

## Busy Behavior And Interruption

Open `DatabaseSync` with a configurable native timeout:

```ts
interface NodeOpenCodeSourceConfig {
  readonly path: string
  readonly sourceID: string
  readonly busyTimeoutMs?: number
}
```

The default is `5000`, matching current OpenCode V2. Use SQLite/Node's native
timeout rather than a JavaScript sleep-and-retry loop.

No automatic retries are included. In particular, a stream never retries after
emitting rows.

No deadline option is included in the initial interface. Synchronous SQLite
cannot honor a deadline during a blocking step, and there is no current product
consumer requiring a query budget. Effect interruption remains meaningful
while waiting for the lease, before statements, and between stream pulls.

Add deadline policy only with a concrete consumer. At that point, define
whether completed buffered rows are discarded when a blocking step returns
after the deadline; do not pre-commit the interface now.

## Tracing And Diagnostics

Tracing is useful but not part of the first read-scope tracer. When added, use
ordinary Effect spans around read-scope acquisition and statements.

Useful bounded attributes include:

- source ID;
- logical schema version;
- phase;
- buffered, streamed, or explain mode;
- row count;
- duration; and
- SQLite code on failure.

Do not attach parameters or complete result rows to every span. This is a
signal-to-noise and data-volume rule, not a security boundary. Explicit compile
results, native causes, local debug logging, and opt-in SQL attributes remain
available for diagnosis.

Statement fingerprints, parsed relation names, retry counts, and policy budgets
are deferred until a consumer needs them. They should not block the execution
module.

## Standalone Behavioral Suite

Test through `LogicalQuery` and `LogicalRead`. Internal fixture hooks may count
native actions where public outcomes cannot prove exact cleanup.

### Required read-scope cases

- one buffered select preserves inferred output;
- two sequential statements use one read-scope ID;
- a pinned WAL snapshot remains stable after a concurrent writer commits;
- a later read scope sees the committed value and has a different ID;
- read-scope provenance is minted only after successful pinning;
- actual writes fail through ordinary and raw/cast paths;
- `EXPLAIN QUERY PLAN` succeeds and returns plan rows;
- source close follows active read-scope cleanup;
- interruption while waiting for the source lease releases no unowned permit;
- pin failure rolls back and releases the permit;
- overlapping statement use fails immediately;
- use after closure performs no native operation.

### Required stream cases

- rows are pulled incrementally rather than buffered with `all()`;
- an empty stream cleans up;
- a never-consumed stream acquires nothing;
- early termination invokes iterator cleanup once;
- native stepping failure invokes iterator cleanup once;
- interruption is observed between pulls;
- a second statement succeeds after stream completion;
- concurrent stream or buffered consumption fails with `read-scope-busy`;
- consuming a leaked stream after read-scope closure fails before prepare;
- the scope-owning convenience stream closes statement, transaction, and lease.

This suite is package-owned. It need not expose a provider harness or simulate a
hypothetical hosted implementation.

## Delivery

### Cut 1: Standalone read scope

Deliver:

- internalize native adapter classes so the package root exposes no native
  handle or statement;
- source semaphore and read-scope state;
- deferred transaction and tested snapshot pin;
- `ReadScopeID`, `ReadProvenance`, and the new `Observation.read` shape;
- `openRead`, buffered `all`, `compile`, and `explain`;
- flexible structured SQLite failures with retained causes;
- one-query buffered helper;
- direct migration of direct search, history, resolve, tests, and registry world
  type; and
- snapshot, cleanup, read-only, and provenance tests.

Delete `LogicalQuery.run`, `Observation.sourceSnapshot`, and flattened
`Observation.observedAt` in the same cut. There is no compatibility layer.

### Cut 2: Streaming

Deliver:

- lazy `LogicalRead.stream`;
- `Effect.acquireRelease` iterator ownership lifted through `Stream.scoped`;
- runtime closed/busy checks;
- bounded pulls and cooperative interruption;
- scope-owning convenience stream;
- supported-Node iterator cleanup verification; and
- the complete stream lifecycle matrix.

### Cut 3: Operational polish, only if useful

Possible work:

- Effect spans;
- statement fingerprints;
- additional SQLite diagnostics;
- benchmarks for long streams and source serialization; and
- deadline or pool design in response to an actual consumer or measurement.

This is not required to validate the read-scope architecture.

## Open-Decision Disposition

The original design listed fifteen open decisions. They are disposed as follows
so implementation is not blocked by a broad design exercise.

| Original question | Disposition |
|---|---|
| Read-scope ID representation | Decide now: Effect Schema-branded non-empty string, currently minted from UUID. |
| Snapshot pin read | Decide now: read `sqlite_schema` after `BEGIN DEFERRED`, subject to the required concurrency proof. |
| Node iterator cleanup | Implementation investigation in Cut 2; raise minimum Node if necessary. |
| Busy timeout | Decide now: configurable native timeout, default 5000 ms. |
| Deadline representation | Defer the entire feature until a consumer requires it. |
| Safe SQLite codes | Preserve Node's string code without a closed allowlist. |
| Statement fingerprints | Defer to operational polish. |
| Relation-name collection | Defer; do not parse SQL merely for tracing. |
| Connection pool threshold | Triggered by measurements showing source serialization is a bottleneck. |
| Hosted transaction joining | Removed with the hosted adapter. |
| Hosted read-only mechanism | Removed with the hosted adapter. |
| Hosted cancellation capability | Removed with the hosted adapter. |
| Diagnostic SQL capability gate | Reject: public explicit compilation is sufficient for this local library. |
| Metrics and access budgets | Defer to the access-policy consumer. |
| Journal mode classification | Treat as source diagnostics used by tests, not a public query capability. |

This distinction matters:

- **Decide now** items shape Cut 1 and now have defaults.
- **Implementation investigation** is work with an objective test, not a product
  tension requiring advance consensus.
- **Triggered** items should not be designed until evidence activates them.
- **Removed** items existed only because the design tried to support two
  materially different products at once.

## Alternatives And Directions

### Scope-owning streams only

An even smaller interface would remove `LogicalRead.stream` and expose only the
`LogicalQuery` convenience stream. That would guarantee transaction lifetime
for ordinary streaming but prevent qualification, streaming hydration, and a
later statement from sharing one snapshot.

This remains a valid simplification if no multi-stage streaming consumer
appears before Cut 2. The current design retains `LogicalRead.stream` because
its implementation is conventional once runtime state exists and because it
preserves compositional headroom without a provider abstraction.

### Callback-bracketed reads

`withRead((read) => ...)` could hide `Scope.Scope` from call sites. It would not
actually prevent capturing or returning `read`, so it offers guidance rather
than stronger lifetime enforcement. A helper may be added if call sites become
clearer, but it is not the fundamental interface.

### Retained stream leases

Reference counting could keep a transaction alive after its lexical read scope
closed. This is rejected because it makes leaked streams work by weakening
lexical ownership, complicates source shutdown, and creates surprising retention
for streams that are constructed but not consumed.

### OpenCode-hosted execution

A hosted implementation could share OpenCode's database, semaphore,
transactions, and domain types. Today that requires a private Core integration
or upstream extension because plugins cannot access those services. It also
changes cotail from an independent history query tool into an OpenCode feature.

Reconsider this direction only with a concrete upstream seam and desired user
experience. Prefer operation-shaped integration over a generic arbitrary-query
provider unless OpenCode deliberately adopts cotail's logical query world.

### Exported provider conformance

The original design proposed an internal provider seam plus an exported
provider-author suite. With one implementation this is speculative surface area.
Keep standalone lifecycle instrumentation internal. Extract a provider seam and
harness if a second adapter is actually built.

### Strict redaction and diagnostic gating

A stricter design could hide parameters, remove causes, gate compiled SQL, and
allowlist trace attributes. This is appropriate across a remote or multi-tenant
boundary. Cotail currently runs locally over the user's own database. Excessive
restriction would make malformed payloads, generated CTEs, and SQLite behavior
harder to debug. Prefer bounded default telemetry and explicit diagnostics.

### Runtime-frozen results

Freezing arrays and rows could enforce the readonly type dynamically. It adds
work and only shallow freezing is cheap; deep freezing would need a policy for
driver values. No provider-owned mutable state escapes after `all()`, which is
the resource-safety requirement that matters here. Keep readonly as a compiler
contract.

## Success Criteria

1. `LogicalQuery` no longer delegates to a stateless `(sql, parameters) => rows`
   function.
2. One `LogicalRead` proves stable multi-statement snapshots under WAL.
3. Direct search observations carry execution-minted read provenance.
4. No operation fabricates a source snapshot or observation time.
5. Buffered reads, explain, and streams share one statement-state mechanism.
6. The convenience stream owns its complete read scope.
7. Direct streams fail safely when consumed after scope closure.
8. Actual writes fail at the native read-only barriers.
9. SQL, parameters, SQLite codes, and native causes remain available for
   intentional local debugging.
10. The public package exposes no native handle or statement.
11. Existing CLI behavior and output remain characterized after the breaking
   internal migration.
12. No hosted-provider abstractions are introduced without a hosted product.

## Cross-References

- [The original execution contract](/.design/query2/design.md) contains the
  broader two-provider design this revision narrows.
- [The scope of the work](/.design/query2/puff.md) motivates the move from a
  stateless executor to scoped ownership; its structural non-escape claims are
  intentionally softened here.
- [The V2 relational query world](/.design/query/design3.gpt56.md) defines the
  logical relations, witnesses, and evidence consumed by this module.
- [Current LogicalQuery](/packages/query-kysely/src/query/logical-query.ts) is
  the stateless execution seam Cut 1 replaces.
- [Current node:sqlite runtime](/packages/query-kysely/src/runtime/node-sqlite.ts)
  provides source acquisition, native barriers, functions, and iterator access
  retained by the standalone implementation.
- [Query runtime registry](/packages/query-runtime/src/registry.ts) remains an
  optional outer acquisition mechanism and does not own read transactions.
