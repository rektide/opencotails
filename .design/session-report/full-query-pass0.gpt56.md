---
type: ProductRequirements
title: Canonical session reporting and operation pass
description: Breaking redesign of Cotail session operations, reports, lineage analysis, and machine output after the V2 query-engine rewrite.
resource: /.design/session-report/full-query-pass0.gpt56.md
tags: [cotail, query, session, reporting, usage, lineage, cli]
status: draft
generated: { by: model:openai/gpt-5.6, at: 2026-08-21T00:00:00Z }
stale_after: 2026-11-21
sources:
  - id: logical-query
    resource: /packages/query-kysely/src/query/logical-query.ts
    title: Scoped logical query interface
  - id: session-relation
    resource: /packages/query-kysely/src/relations/schema.ts
    title: Cotail session relation
  - id: current-results
    resource: /packages/query-kysely/src/domain/results.ts
    title: Current operation result types
  - id: execution-design
    resource: /.design/query2/design2.gpt56.md
    title: Standalone query execution design
---

# Canonical Session Reporting And Operation Pass

## Situation

The V2 logical query world and scoped execution module are now substantially
stronger than the command-oriented operations built on top of them. Session
reporting still carries several pre-rewrite shapes:

- `SessionSummary`, `SessionDetails`, and `HistoryEntry` overlap but disagree on
  names such as `id` versus `sessionID` and `projectId` versus `projectID`;
- resolve, history, and direct search repeat partial session projections;
- only search returns a source-qualified target and read provenance;
- command-local DTOs translate those results again for JSON, TSV, and Arrow;
- machine formats disagree on field names and timestamp representation; and
- pending reporting tickets refer to deleted files and old physical-query
  builders.

There are no compatibility consumers to preserve. This pass should replace the
shallow result interfaces rather than extend them.

The execution seam remains sound. `LogicalQueryShape` and `LogicalRead` continue
to own source validation, scoped snapshots, provenance, compilation, buffered
reads, streaming, and explain. This design changes domain operations and output,
not the execution module.

## User Decisions

1. Perform the full operation redesign, not only a basic-field addition.
2. Human token usage uses the labels `i/o/r/cr/cw`.
3. Human token values use decimal compact units, round to at most three
   significant digits, and trim insignificant trailing zeros.
4. Examples include `20.4k`, `1.32M`, and `1.32k`.
5. Machine formats retain exact raw counters.
6. Session usage reporting and child-session usage analysis remain separate
   features and tickets.

## Goals

1. Establish one canonical report for cheap persisted Session facts.
2. Return source-qualified, read-provenanced Session observations consistently.
3. Give lookup, heuristic resolution, listing, history, search, and lineage
   explicit and non-overloaded semantics.
4. Remove repeated session projection and mapping code.
5. Generate JSONL, TSV, and Arrow from shared command output specifications.
6. Make human output compact without weakening machine precision.
7. Support bounded, cycle-safe child usage analysis after lineage relations land.

## Non-Goals

- Do not redesign `LogicalQueryShape` or the node:sqlite adapter.
- Do not add dynamic field loading for columns already present on
  `cotail_session`.
- Do not infer that every continuation child is a subagent.
- Do not derive authoritative session usage by re-summing message payloads.
- Do not preserve old result types, machine schemas, aliases, or field names.

## Canonical Domain Model

Operations return `Observation<SessionAddress, SessionReport>`. The target owns
the Session identity and source identity; the report owns Session attributes.
The observation carries the read scope and observation time. A Session report
does not invent a content revision when the source provides none.

```ts
interface SessionReport {
  readonly title: string | null;
  readonly slug: string;
  readonly location: {
    readonly projectID: string;
    readonly workspaceID: string | null;
    readonly directory: string;
    readonly path: string | null;
  };
  readonly lineage: {
    readonly parentSessionID: string | null;
    readonly forkSessionID: string | null;
    readonly forkBoundary: string | null;
  };
  readonly run: {
    readonly version: string;
    readonly agent: string | null;
    readonly model: string | null;
  };
  readonly usage: {
    readonly cost: number;
    readonly tokens: {
      readonly input: number;
      readonly output: number;
      readonly reasoning: number;
      readonly cache: {
        readonly read: number;
        readonly write: number;
      };
    };
  };
  readonly summary: {
    readonly additions: number | null;
    readonly deletions: number | null;
    readonly files: number | null;
  };
  readonly shareURL: string | null;
  readonly lifecycle: {
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly compactingAt: number | null;
    readonly archivedAt: number | null;
    readonly suspendedAt: number | null;
  };
}
```

All direct scalar fields are always loaded. They already come from one logical
relation, so optional report layers would enlarge the interface and create
sparse-result invariants without avoiding meaningful work.

Opaque `metadataJSON`, `summaryDiffsJSON`, `revertJSON`, and `permissionJSON`
remain available through the logical relation but are not part of the ordinary
report. They require explicit parsing, exposure, and failure policies before
becoming report fields.

## Shared Projection And Decoder

One internal projection selects the report columns with stable aliases. One
decoder validates and nests those columns, constructs the source-qualified
Session target, and attaches the `LogicalRead` provenance. Resolve, history,
search, and lineage use this implementation rather than maintaining independent
partial projections.

The projection and decoder are internal seams. The external interface is the
operation result, not a public list of SQL aliases.

## Operation Vocabulary

Replace `resolveSession({ mode })` with operations whose names state their
cardinality and ordering:

- `getSession(query, sessionID)` performs an exact ID lookup and distinguishes
  not-found from success.
- `findLatestSession(query, predicate)` performs the explicitly heuristic
  `updatedAt DESC, sessionID DESC` resolution used for directory and PID lookup.
- `listSessions(query, request)` provides deterministic keyset pagination and
  explicit ordering. A page size is a positive safe integer; zero never means
  unlimited.

Operation-specific data wraps, rather than extends, the report:

```ts
interface SessionHistoryItem {
  readonly session: Observation<SessionAddress, SessionReport>;
  readonly activity: {
    readonly since: number;
    readonly messagesTotal: number;
    readonly messagesSince: number;
  };
}
```

Direct search returns the same Session observation alongside evidence and
truncation state. Message-count history uses one grouped message aggregate joined
to qualified Sessions rather than two correlated count subqueries.

Session predicates should expose the complete stable identity and placement
context needed by operations, including `workspaceID`, `parentID`, created time,
and updated time. Domain-specific lineage traversal should use
`cotail_lineage_edge`, not pretend every nullable parent field has the same edge
semantics.

## Child Usage Analysis

Child analysis is a separate operation and ticket that depends on the planned
lineage relation. Its request must state a positive maximum depth and whether it
selects direct continuation children or all descendants. Traversal runs as one
bounded recursive query in one `LogicalRead` so all nodes share a snapshot.

The result reports:

- direct child count;
- descendant count;
- each present Session observation and depth;
- own usage and descendant usage totals;
- aggregate direct-child and descendant token counters and cost;
- typed continuation versus fork edges; and
- explicit dangling and cycle findings.

The interface says “child Session” or “continuation” unless separate evidence
proves a Session was created by a subagent tool.

Session-level projected counters are authoritative. Message-level counters remain
available for turn analysis but are not silently re-summed as a replacement.

## Output Architecture

Each command defines one serializer-neutral output specification containing an
ordered machine field name, logical type, nullability, and accessor. Shared
emitters derive JSONL records, escaped TSV rows, and Arrow fields/vectors from
that specification.

Machine output rules are intentionally breaking and uniform:

- field names use `snake_case` in JSONL, TSV, and Arrow;
- timestamps are epoch milliseconds in JSONL and TSV and Arrow millisecond
  timestamps in Arrow;
- token counters and message counts remain exact integers;
- null handling is explicit and consistent;
- TSV escapes tabs, newlines, carriage returns, quotes, and nulls; and
- command schemas remain purpose-specific rather than becoming one sparse global
  schema.

Human rendering remains command-specific. Formatting does not leak into domain
reports or machine output.

## Compact Token Formatting

The human usage line uses stable decimal units and no locale-dependent compact
formatter:

```text
i 20.4k  o 1.32k  r 944  cr 1.32M  cw 0
```

Rules:

1. Use `k`, `M`, `G`, `T`, and `P` for powers of 1,000.
2. Choose the largest unit whose scaled absolute value is at least one.
3. Round to at most three significant digits.
4. Trim trailing fractional zeros and the decimal point when empty.
5. Promote to the next unit if rounding would produce `1000` of the current
   unit.
6. Preserve zero and sign.
7. Keep cost formatting separate from token formatting.

Examples:

| Raw | Human |
|---:|---:|
| `0` | `0` |
| `999` | `999` |
| `1000` | `1k` |
| `1320` | `1.32k` |
| `20400` | `20.4k` |
| `999500` | `1M` |
| `1320000` | `1.32M` |

## Migration

1. Add the canonical report, shared projection/decoder, and exact-ID operation.
2. Migrate `get-session` to the report and add all direct fields to its machine
   output.
3. Add explicit latest and paged-list operations; migrate history and replace
   correlated activity counts.
4. Migrate direct search to embed the canonical Session observation.
5. Add shared output specifications and migrate JSONL, TSV, and Arrow.
6. Add compact human usage and the remaining basic direct fields.
7. Delete `SessionSummary`, `SessionDetails`, `HistoryEntry`, `SessionCounts`,
   repeated projections, and command-local machine DTOs.
8. Add child usage analysis only after `cotail_lineage_edge` lands.

Each migration commit must leave all commands and package tests passing. No
compatibility aliases remain after their callers move.

## Verification

- Mapping tests cover every report scalar, null, and nested facet.
- Operation tests cover not-found, exact-ID, ambiguity, deterministic ordering,
  cursor boundaries, and positive page-size validation.
- History plans show one grouped message aggregate rather than correlated counts.
- Search, history, and lookup return the same report for one fixture Session.
- Output contract tests compare JSONL, escaped TSV, and Arrow names, nullability,
  values, and timestamp semantics.
- Token formatter table tests cover unit boundaries, rounding promotion, signs,
  zero, and values through `P`.
- Child analysis tests cover direct children, descendants, depth limits, cycles,
  dangling edges, and aggregate overflow policy.

## Risks And Decisions Still Needed

- SQLite integers and JavaScript numbers may eventually lose precision when
  aggregating very large descendant trees. Child analysis must either reject
  unsafe totals or use an exact representation; it must not silently round.
- Fork boundary JSON needs a typed decoder before the report can expose more than
  its persisted opaque representation.
- Shared output specifications should remain shallow data declarations. Query
  policy and human layout do not belong in that module.

## Cross-References

- [Standalone query execution](/.design/query2/design2.gpt56.md) defines the
  scoped read and provenance seam retained by this redesign.
- [Relational query-world design](/.design/query/design3.gpt56.md) explains why
  operations consume cotail-owned logical relations rather than physical tables.
- [Current session relation](/packages/query-kysely/src/relations/schema.ts)
  already exposes the direct fields this report projects.
- [Current operation results](/packages/query-kysely/src/domain/results.ts) are
  the overlapping compatibility shapes this pass replaces.
- [Durable bookmarks](/.design/query/design3.gpt56.md) (the `Bookmarks` section
  of the query-world design, tracking epic `cotail-bookmarks`) is the main
  downstream consumer of this pass: a session-grain `BookmarkCapture` stores
  exactly the `Observation<SessionAddress, SessionReport>` that every operation
  here returns, and four-state bookmark resolution (current/changed/missing/
  source-unavailable) is why the report refuses to invent a content revision.
  The shared projection and decoder should become the single capture producer.
- [Bookmark wave draft4](/.design/bookmarks/draft4.glm52.md) is the ancestor of
  the report shape: its layered `SessionInfo` (identity/run/cost/summary/fork/
  share/lifecycle) became these nested facets. This pass supersedes two of its
  open decisions — naming resolves to capital-ID domain fields with uniformly
  snake_case machine output, and physical column capability detection is
  dissolved by the `cotail_session` logical relation. Its
  [`applications`](/.design/bookmarks/applications.glm52.md) consumers
  (`journal`, `tree`, `diff`) would read these observations.
- Fork boundary tickets `cotail-fork-point` and `cotail-fork-time` share this
  pass's typed-decoder prerequisite: the report keeps `forkBoundary` opaque,
  and both boundary rendering and fork-time lineage must resolve it through
  `cotail_lineage_edge` ancestor-owned semantics rather than child columns.
- [Watch research](/.design/watch/README.md) needs the same history activity
  aggregate (`SessionHistoryItem.activity`) for its activity view, and its
  compaction-boundary auto-producer watches `lifecycle.compactingAt` — a field
  this report makes uniformly available.
- `cotail-end-session` wants a completion bookmark; the canonical observation
  defined here is what that bookmark would capture and hand to future threads.
- [History viewer design](/.design/history-viewer/design.md) is the shipped
  ancestor of the history rebuild. Note the deliberate break: its ISO-8601 JSON
  timestamps become epoch milliseconds under the uniform machine output rules.
