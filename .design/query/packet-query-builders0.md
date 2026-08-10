---
type: DesignPacket
title: Cotail typed query-builder evaluation packet
description: Shared source, constraints, questions, and acceptance criteria for comparing Kysely and Drizzle against the synthesized query architecture.
resource: /query/packet-query-builders0.md
tags: [cotail, query, kysely, drizzle, sqlite, architecture]
status: draft
generated: { by: model:openai/gpt-5.6-sol, at: 2026-08-11T00:00:00Z }
sources:
  - id: synthesized-baseline
    resource: /query/draft1.syn.md
    title: Synthesized query architecture baseline
  - id: corrected-baseline
    resource: /query/draft1.gpt56sol.md
    title: Operation-shaped architecture and mixed-layout correction
  - id: v2-storage
    resource: /v2.md
    title: opencode V2 storage research
  - id: current-query
    resource: /src/opencode/source.ts
    title: Current content query compiler
  - id: current-search
    resource: /src/commands/search.ts
    title: Current search command
  - id: current-history
    resource: /src/opencode/session.ts
    title: Current history query
  - id: kysely-sqlite-contract
    resource: https://github.com/kysely-org/kysely/blob/master/src/dialect/sqlite/sqlite-dialect-config.ts
    title: Kysely SQLite dialect contract
  - id: drizzle-source
    resource: https://github.com/drizzle-team/drizzle-orm/tree/main/drizzle-orm/src
    title: Drizzle ORM driver source tree
---

# Cotail Typed Query-Builder Evaluation Packet

## Assignment

Design an executable alternative to the current hand-built SQL architecture
using the assigned typed query builder. The proposal must improve on the
synthesized baseline rather than merely translating SQL calls into fluent
syntax.

The Kysely proposal is written first. The Drizzle author receives this packet
and the Kysely proposal, and should independently make the strongest Drizzle
case while identifying Kysely's weaknesses. The Kysely author then reviews the
Drizzle proposal and writes a new refinement. An independent adjudicator selects
the winner and produces an implementation brief.

## Baseline To Improve

Read these fully:

1. [`draft1.syn.md`](/query/draft1.syn.md) for the broad synthesis and unresolved
   architecture decisions.
2. [`draft1.gpt56sol.md`](/query/draft1.gpt56sol.md) for stricter operation-shaped
   contracts, mixed-layout history concerns, and V2 semantic mapping.
3. [`../v2.md`](/v2.md) for authoritative V2 storage findings.

Inspect the implementation seams:

- [`src/opencode/types.ts`](/src/opencode/types.ts)
- [`src/opencode/source.ts`](/src/opencode/source.ts)
- [`src/opencode/v1/source.ts`](/src/opencode/v1/source.ts)
- [`src/opencode/v2/source.ts`](/src/opencode/v2/source.ts)
- [`src/opencode/session.ts`](/src/opencode/session.ts)
- [`src/opencode/session-info.ts`](/src/opencode/session-info.ts)
- [`src/commands/search.ts`](/src/commands/search.ts)

## Non-Negotiable Domain Semantics

### Session root and witness scope

- A session is the result and deduplication root.
- Session metadata predicates range over one live opencode `session` row.
- A content requirement is satisfied by one content-unit witness.
- Patterns grouped inside one requirement apply to the same witness.
- Separate requirements may use separate witnesses.
- Evidence is projection and cannot affect qualification.

### Bounded boolean vocabulary

The design must include `all`, `any`, and `none` at both useful scopes without a
generic recursive predicate AST:

```ts
interface PatternSet {
  all?: readonly TextPattern[];
  any?: readonly TextPattern[];
  none?: readonly TextPattern[];
}

interface ContentRequirements {
  all?: readonly ContentRequirement[];
  any?: readonly ContentRequirement[];
  none?: readonly ContentRequirement[];
}
```

It must define validation of empty groups, truth tables, SQL lowering, witness
selection for evidence under `any`, and `NOT EXISTS` semantics under `none`.
Cross-relation recursive boolean composition remains out of scope.

### Metadata authority and content acceleration

The strongest insight from the initial alternatives is structural:

> FTS is a content-match accelerator. Session metadata is always authoritative
> in opencode's live database.

The package graph and interfaces must reflect this, not merely mention it. Live
history, lookup, session identity, and metadata selection must not become
dependent on the cotail index. Indexed search may carry denormalized metadata
for pushdown, but freshness and reconciliation are explicit. The proposal must
say whether indexed hits are hydrated from live metadata, how missing/deleted
sessions behave, and how this affects ranking and limits.

### Honest hit types, shared rendering

Direct and indexed hits may remain distinct because evidence and ranking differ,
but renderers need one structural surface:

```ts
interface SearchResult {
  session: SessionSummary;
  evidenceText?: string;
}
```

Concrete results may satisfy this directly or through a projection adapter. Do
not erase provenance, rank, highlights, witness IDs, or freshness merely to
force one universal result type. Show how `search` chooses a backend and invokes
shared human/JSONL rendering without backend conditionals spreading through the
command.

### Mixed V1/V2 normalization

- Native V2 content lives in `session_message`, not the `event` fallback.
- Legacy V1 `part` and native V2 `session_message` can coexist in one database.
- Content and message counts need a per-session precedence policy to avoid
  misses and duplicate projections.
- V2 witness order uses `session_message.seq` plus content-array position.
- User/assistant text, reasoning, tool, shell, and other V2 message types need an
  explicit semantic mapping or explicit exclusion.

## Repository Shape

The result must be a well-decomposed pnpm workspace, not a flat collection of
query files. Treat "multi-crate" as package-level architectural enforcement for
this TypeScript project. Propose multiple plausible domain groupings, select
one, and show an acyclic dependency graph.

At minimum, evaluate boundaries for:

- session domain values and metadata operations;
- opencode live-store schema/layout adapters;
- direct content search;
- indexed content search and index freshness;
- renderer-facing result contracts;
- CLI commands/composition root; and
- test fixtures/contracts.

Do not create a package for every file. Each package must be a deep module with a
small exported surface and enough hidden complexity to justify the boundary.
Explain why each boundary needs package enforcement rather than a directory.

## Runtime And Dependency Constraints

- Current runtime is Node.js 22+ and `node:sqlite` `DatabaseSync`.
- The source opencode database is opened read-only and registers a JavaScript
  regex function.
- Do not assume a builder supports `node:sqlite`; prove the integration path.
- New packages must be installed with `pnpm install <name>@latest`, never by
  manually editing `package.json`.
- Development runs TypeScript directly with Node; build output is for package
  distribution only.
- Internal TypeScript imports include explicit `.ts` extensions.
- Query construction may be asynchronous even though `node:sqlite` execution is
  synchronous; trace the consequences through CLI and tests.

## Builder-Specific Evidence

### Kysely

Local source: `/home/rektide/archive/kysely-org/kysely` at version `0.29.4`.

Kysely's SQLite dialect consumes a small `better-sqlite3`-shaped interface:

- `database.prepare(sql)`;
- statement `reader`;
- `all(parametersArray)`;
- `run(parametersArray)`; and
- `iterate(parametersArray)`.

See [`sqlite-dialect-config.ts`](https://github.com/kysely-org/kysely/blob/master/src/dialect/sqlite/sqlite-dialect-config.ts)
and [`sqlite-driver.ts`](https://github.com/kysely-org/kysely/blob/master/src/dialect/sqlite/sqlite-driver.ts).
`node:sqlite` is similar but not identical: parameter calling conventions and
reader detection need a tested adapter, or the proposal must choose another
driver and account for the cost. Investigate raw `sql` expressions, JSON
functions, correlated `EXISTS`, CTE/union composition, custom function calls,
read-only typing, compiled-query inspection, and result inference.

### Drizzle

Local source: `/home/rektide/archive/drizzle-team/drizzle-orm` at
`drizzle-orm` version `0.45.3`.

The archived driver tree includes `better-sqlite3`, `libsql`, `bun-sqlite`, D1,
and other SQLite integrations, but no native `node:sqlite` integration. A
Drizzle proposal must either:

- demonstrate a maintainable custom `node:sqlite` session/driver;
- adopt a supported driver and justify replacing the current runtime seam; or
- conclude that Drizzle is not a viable winner for this project.

Investigate schema declaration for an externally owned and version-varying
database, raw SQL/JSON extraction, correlated subqueries, unions/CTEs, dynamic
query composition, read-only safety, and whether schema-first ORM machinery adds
or removes complexity for mixed V1/V2 layouts.

## Required Worked Examples

Each proposal must show realistic TypeScript for:

1. adapting or replacing `node:sqlite`;
2. declaring the stable `session` relation and variable V1/V2 relations;
3. compiling `SessionSelector`, including contains/exact directory and half-open
   time ranges;
4. title `PatternSet` with `all`/`any`/`none`;
5. content requirements with independent and same-witness matching;
6. requirement-level `all`/`any`/`none` using correlated subqueries;
7. evidence from the selected witness;
8. history counts without mixed-layout double counting;
9. direct result mapping into the renderer-facing `SearchResult`;
10. representative generated SQL and bound parameters; and
11. a fixture test that executes against `node:sqlite`, not only a type-level
    sketch.

## Evaluation Criteria

The adjudicator should score each proposal against the baseline on:

| Criterion | Question |
|---|---|
| Runtime fit | Does it work with Node 22+ and the actual read-only `node:sqlite` connection without an unjustified driver swap? |
| Semantic clarity | Are session predicates, witnesses, evidence, aggregates, and boolean scopes explicit? |
| SQL expressiveness | Can it express JSON extraction, correlated subqueries, unions/CTEs, custom `re()`, and mixed layouts without raw-SQL soup? |
| Type leverage | Does the builder catch useful errors in this dynamic external schema, or mostly require casts and escape hatches? |
| Module depth | Do workspace packages enforce metadata/search/render boundaries with small interfaces? |
| Metadata authority | Is the live opencode/index distinction structurally unavoidable? |
| Rendering | Can concrete backend hits share rendering without losing backend-specific facts? |
| Testability | Can behavior be fixture-tested without freezing generated SQL? |
| Migration safety | Can implementation land in coherent commits while preserving the CLI? |
| Dependency cost | Is the runtime, install, maintenance, and ecosystem cost justified? |

Reject any proposal that cannot execute representative queries against the
actual runtime. Prefer the smallest architecture that materially improves type
safety, composability, and package-level dependency direction over the baseline.

## Deliverables

Each design document must include:

- decision and thesis;
- package/dependency diagram;
- public and private interfaces;
- actual adapter strategy;
- worked query-builder examples and generated SQL;
- boolean and evidence semantics;
- live metadata/indexed search structure;
- shared rendering strategy;
- migration sequence in small commits;
- tests and executable spikes required;
- risks and rejection conditions; and
- comparison against [`draft1.syn.md`](/query/draft1.syn.md).

Do not implement production code during the initial design wave. Small spikes
belong under `.test-agent/query-builders/` with a README that records commands
and findings.
