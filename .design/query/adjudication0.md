---
type: Adjudication
title: Typed query-builder adjudication
description: Selects refined Kysely over the hand-built baseline and Drizzle, with a narrowed implementation graph and mandatory runtime and semantic gates.
resource: /query/adjudication0.md
tags: [cotail, query, kysely, drizzle, sqlite, architecture, decision]
status: stable
generated: { by: agent:architecture-adjudicator, at: 2026-08-11T00:00:00Z }
stale_after: 2026-11-11
sources:
  - id: evaluation-packet
    resource: /query/packet-query-builders0.md
    title: Cotail typed query-builder evaluation packet
  - id: baseline
    resource: /query/draft1.syn.md
    title: Synthesized query architecture baseline
  - id: corrected-baseline
    resource: /query/draft1.gpt56sol.md
    title: Operation-shaped session query architecture
  - id: refined-kysely
    resource: /query/draft-ksyley1.md
    title: Refined Kysely query architecture
  - id: drizzle
    resource: /query/draft-drizzle0.md
    title: Executable Drizzle query architecture counterproposal
  - id: production-source
    resource: /src/opencode/source.ts
    title: Current content query compiler
  - id: spike-results
    resource: /.test-agent/query-builders/README.md
    title: Executable query-builder spikes
---

# Typed Query-Builder Adjudication

## Verdict

**Select refined Kysely, conditionally. Reject Drizzle for this implementation.**

Kysely is a solid and material improvement over the hand-built baseline when it
is kept private inside the live-store package. It preserves the required
`node:sqlite` runtime, gives useful static checks over tables, columns, aliases,
correlation, set-operation shapes, selected rows, and bound values, and removes
the current positional-binding and SQL-fragment interfaces. It does not remove
the need to understand SQLite or the external schema. JSON paths, UDF calls,
table-valued `json_each`, layout existence, and domain validity remain runtime
concerns.

Kysely beats Drizzle decisively under the packet's constraints. Drizzle's
camelCase schema properties and synchronous API are pleasant but not worth
replacing a built-in runtime with `better-sqlite3`, accepting a native release
matrix, enabling `skipLibCheck`, and relying on a spike whose runtime version
differs from the audited source. A custom Drizzle `node:sqlite` driver is not a
maintainable alternative because its correct result mapping depends on internal
APIs.

This selects the core of [`draft-ksyley1.md`](/query/draft-ksyley1.md), not every
feature in it. Initial implementation is narrowed to the domain and live-store
packages. The index, hydration service, indexed request language, freshness,
ranking, and backend selection are deferred until an executable FTS design.

## Scoring

Scores are 0-5. Weighted points equal `weight * score / 5`. The baseline is the
best corrected hand-built design, not the bugs in current production alone.

| Criterion | Weight | Baseline | Refined Kysely | Drizzle | Reason |
|---|---:|---:|---:|---:|---|
| Runtime fit | 16 | 3.0 | 4.0 | 2.0 | Hand SQL already runs on `node:sqlite`; Kysely's narrow adapter executes but lacks minimum-Node proof; Drizzle requires a driver swap. |
| Semantic clarity | 14 | 4.0 | 5.0 | 5.0 | Both proposals fully specify session roots, bounded boolean scopes, witnesses, negative requirements, and evidence. |
| SQL expressiveness | 10 | 4.0 | 4.0 | 4.0 | Both builders execute CTE/union, correlation, JSON, UDF, evidence, and negation; SQLite-specific fragments remain raw in both. |
| Actual type leverage | 10 | 2.0 | 4.0 | 3.5 | Kysely checks meaningful composition under strict `tsgo`; Drizzle has stronger property mapping but needs `skipLibCheck`; neither checks JSON paths or table presence. |
| Module depth | 12 | 3.0 | 4.5 | 4.5 | Both package proposals enforce domain/storage direction; the baseline only suggests directories and one broad store. |
| Metadata authority | 12 | 3.5 | 5.0 | 5.0 | Candidate-only index output plus a separate hydration dependency makes live authority structural rather than advisory. |
| Rendering | 7 | 3.5 | 4.5 | 4.5 | Distinct concrete hits structurally satisfy `SearchResult` while JSONL preserves provenance. |
| Testability | 7 | 3.5 | 4.0 | 3.5 | Both execute behavior fixtures; Kysely checks strictly, but both spikes cover materially less than their proposed matrices. |
| Migration safety | 7 | 4.5 | 4.0 | 2.5 | Kysely can be introduced behind current operations; Drizzle begins with a runtime and installation change. |
| Dependency cost | 5 | 5.0 | 4.0 | 1.5 | Baseline adds nothing; Kysely is pure TypeScript; Drizzle adds an ORM and native addon. |
| **Weighted total** | **100** | **69.5** | **87.1** | **74.4** | |

The 17.6-point Kysely gain over baseline is material. Most of the gain is not
fluent syntax. It comes from checked composition, package direction, resolved
boolean semantics, live metadata authority, honest hit types, and an executable
runtime adapter. Kysely alone would not justify a rewrite; this architecture does.

## Runtime Truth

I reran both isolated checks on 2026-08-11 with Node `v26.6.0`:

```sh
# from .test-agent/query-builders/kysely/
CI=true pnpm exec tsgo -p tsconfig.json
node index.ts > /tmp/opencode/kysely-adjudication-result.json
cmp result.json /tmp/opencode/kysely-adjudication-result.json

# from .test-agent/query-builders/drizzle/
CI=true pnpm exec tsgo -p tsconfig.json
node index.ts > /tmp/opencode/drizzle-adjudication-result.json
cmp result.json /tmp/opencode/drizzle-adjudication-result.json
```

All six commands exited 0. Kysely 0.29.4 returned `v2`, then `v1`, with 19
bindings. Drizzle 0.45.2 with `better-sqlite3` 13.0.3 returned the same sessions
with 22 bindings. Both excluded `dupe` because a nonmatching native row suppressed
matching V1 content. The checked artifacts are
[`kysely/result.json`](/.test-agent/query-builders/kysely/result.json) and
[`drizzle/result.json`](/.test-agent/query-builders/drizzle/result.json).

The proof is representative, not complete:

- Kysely ran on Node 26, not the minimum supported Node 22 release.
- Its fixture uses an in-memory writable database, not an actual read-only file.
- The adapter defines `iterate()` and write rejection, but the fixture does not
  call either. It proves `all()` and close delegation only.
- Neither spike executes requirement-level `any` or combinations of requirement
  `all`/`any`/`none`; each proves one positive `EXISTS` and one `NOT EXISTS`.
- Neither executes V2 assistant content-array `json_each`, roles, reasoning,
  tools, shell records, history count precedence, live hydration, or rendering.
- Drizzle additionally runs 0.45.2 while citing 0.45.3 source and suppresses
  dependency declaration errors with `skipLibCheck`.

These limits correct broader claims in the proposals and become gates below.

## Why Kysely Improves Production

Current production exposes physical SQL fragments through `VersionSchema` and
constructs correlated SQL by string interpolation
([`src/opencode/source.ts:12-45`](/src/opencode/source.ts)). It chooses V1 whenever
`part` exists and consults the obsolete `event` fallback only when it does not
([`src/opencode/source.ts:48-53`](/src/opencode/source.ts)), so a mixed database
silently misses native V2 content. Title search duplicates directory/time
selection and positional binding in the command
([`src/commands/search.ts:30-46`](/src/commands/search.ts)). History adds V1 and
V2 counts and can double count transition sessions
([`src/opencode/session.ts:13-37`](/src/opencode/session.ts)). Search deduplicates
after independently limited source queries, which can produce the wrong global
limit and ordering ([`src/commands/search.ts:58-68`](/src/commands/search.ts)).

Kysely usefully replaces those mechanisms with one session-root query, typed
correlated expressions, builder-managed binding order, checked normalized CTE
shape, and inferred selected rows. Runtime capability checks still decide which
external tables and columns may be referenced. Domain validators still decide
whether requests are meaningful. Fixture tests still decide whether JSON paths,
layout precedence, witness order, and counts are correct.

## Corrections To The Winner

The following are non-negotiable before production migration:

1. **Prove the actual minimum runtime.** Run adapter tests on the project's
   minimum Node 22.x release against a temporary file reopened with
   `{ readOnly: true }`. Exercise `all`, `iterate`, `destroy`, idempotent store
   close, operation-after-close failure, and a forced write reaching `run()`.
2. **Do not claim universal V2 precedence from the synthetic spike.** "Any
   `session_message` row suppresses V1" can hide legacy content when native rows
   are control-only or a transition is partial. Obtain real transition fixtures
   or define a reliable authority discriminator. Stop before replacing V1/V2
   source selection if this cannot be justified.
3. **Separate content and count authority tests.** A content-layout decision does
   not automatically prove that `message` and `session_message` counts are
   duplicate projections. Test zero, partial, control-only, and duplicated rows
   independently before adopting the proposed `CASE` expression.
4. **Implement both bounded scopes completely.** Validate `{}`, every present
   empty group, invalid regex, empty/duplicate types and roles, and invalid
   limits/ranges. Execute pattern and requirement `all`, `any`, `none`, and mixed
   groups. Requirement `none` must be correlated `NOT EXISTS`.
5. **Keep evidence mechanically derived from positive requirements.** Reuse the
   same private witness predicate factory for qualification and projection.
   Evidence order is positive `all` request order, then matching `any` request
   order, then `(ordinalMajor, ordinalMinor, contentId)`. `none` is ineligible.
6. **Do not advertise unsupported V2 semantics.** Ship user text, assistant text,
   and assistant reasoning only after `json_each` fixtures. Preserve current V1
   tool behavior during migration, but reject V2 tool and shell requests until a
   canonical searchable text representation is approved.
7. **Keep Kysely physically private.** No command, renderer, domain package, or
   exported interface may mention `Kysely`, table declarations, SQL fragments,
   compiled queries, or `DatabaseSync`.
8. **Preserve output before normalizing it.** Domain timestamps may be epoch-ms,
   but current search JSONL uses `created`/`updated` SQLite datetime strings,
   history JSONL uses snake-case ISO strings, and human output has exact truncation
   and footer behavior. Compatibility render adapters must keep these byte-stable.
9. **Make asynchronous execution honest.** Kysely's promise does not make
   `DatabaseSync` nonblocking. Await once at operation boundaries, do not use
   `Promise.all` on one connection, and make CLI `run`/`main` async without
   changing exit codes or error text.
10. **Measure the normalized CTE.** Compare `EXPLAIN QUERY PLAN` and behavior on a
    representative database. A builder can make a full-scan CTE easier to write;
    it cannot make it acceptable.

## Deferred Features

Do not implement these in the first query-builder migration:

- `content-index`, `search-service`, FTS schema/migrations, indexing, hydration,
  freshness generations, BM25 ranking, highlights, or backend selection;
- `IndexedSearchRequest`, advanced FTS syntax, or `updated-desc` indexed cursors;
- V2 tool/shell canonicalization, control-record search, or expanded role flags;
- title-plus-content composition, a recursive predicate AST, a public plan, or a
  generic backend interface;
- new project/date/role CLI options, pagination, or output schema changes; and
- package publication or build-output changes.

The future index architecture remains constrained: `content-index ->
query-domain`; `search-service -> content-index + opencode-live-store +
query-domain`; the index returns candidates, never `SessionSummary` or a
renderable hit. This is a design constraint, not current implementation scope.

## Implementation Brief

### Selected workspace and dependencies

Create exactly these workspace packages for the initial implementation:

```text
packages/
  query-domain/
    src/index.ts
    src/session.ts
    src/search.ts
    src/history.ts
    src/validation.ts
  opencode-live-store/
    src/index.ts
    src/runtime/node-sqlite.ts
    src/schema/capabilities.ts
    src/schema/tables.ts
    src/query/selector.ts
    src/query/session-row.ts
    src/query/title.ts
    src/query/content.ts
    src/query/history.ts
    src/layout/v1.ts
    src/layout/v2.ts
  test-contracts/
    src/index.ts
    src/fixtures/database.ts
    src/suites/search.ts
    src/suites/history.ts
```

Retain the repository root package `opencoattails` as the CLI composition root
and renderer owner. Do not create `content-index`, `search-service`, or a separate
renderer package yet. Current rendering is not deep enough to justify another
package before a second backend exists.

Exact edges:

```text
@opencoattails/query-domain          -> no workspace dependency
@opencoattails/opencode-live-store   -> @opencoattails/query-domain, kysely
@opencoattails/test-contracts        -> @opencoattails/query-domain (dev-only package)
opencoattails root                   -> @opencoattails/query-domain,
                                        @opencoattails/opencode-live-store
opencode-live-store tests            -> @opencoattails/test-contracts (dev edge)
root CLI tests                       -> @opencoattails/test-contracts (dev edge)
```

Only `opencode-live-store` may import `kysely`. Add the production dependency
from the workspace root with the required command, not a manual manifest edit:

```sh
pnpm install kysely@latest
```

Pin the resolved 0.29.x version in the lockfile. Stop if `@latest` is no longer
0.29.x until the adapter contract and spike are rerun against the resolved major.
Configure `pnpm-workspace.yaml` with `packages/*`; preserve its existing override.

### Required public interfaces

`query-domain` exports `SessionSummary`, `SessionSelector`, `DirectorySelector`,
`TimeRange`, `TextPattern`, `PatternSet`, `ContentRequirement`,
`ContentRequirements`, `DirectSearchRequest`, `DirectSearchHit`, `SearchResult`,
`HistoryRequest`, `HistoryEntry`, `ResolveRequest`, and validation functions.

The key contracts are:

```ts
export interface PatternSet {
  all?: readonly TextPattern[];
  any?: readonly TextPattern[];
  none?: readonly TextPattern[];
}

export interface ContentRequirements {
  all?: readonly ContentRequirement[];
  any?: readonly ContentRequirement[];
  none?: readonly ContentRequirement[];
}

export interface SearchResult {
  session: SessionSummary;
  evidenceText?: string;
}

export interface OpenedOpencodeLiveStore {
  searchDirect(request: DirectSearchRequest): Promise<readonly DirectSearchHit[]>;
  history(request: HistoryRequest): Promise<readonly HistoryEntry[]>;
  resolve(request: ResolveRequest): Promise<SessionSummary | undefined>;
  close(): Promise<void>;
}
```

Do not add `hydrate` or `matches` until indexed search exists. Their only current
consumer would be speculative. Private interfaces include `LayoutCapabilities`,
physical tables, normalized content columns, selected rows, adapter classes, and
Kysely builders.

### Ordered commits and acceptance

1. **Characterize the current CLI.** Add black-box fixtures for search title and
   content, independent witnesses, first-pattern snippet, no snippet, limit zero,
   directory/since, history counts and formats, lookup, error exits, human output,
   JSONL, and TSV. Acceptance: all fixtures execute current `src/cli.ts` and save
   byte-for-byte outputs without production changes.
2. **Establish workspace domain contracts.** Add `query-domain` and
   `test-contracts`, selector/request/result types, and pure validators. Acceptance:
   strict `tsgo`; tests reject every empty/malformed group and prove truth tables
   without importing SQL or Kysely.
3. **Install Kysely and prove the adapter.** Run the install command; add the
   select-only adapter, capability detection, and owned lifecycle. Acceptance:
   Node 22 read-only-file tests cover `all`, `iterate`, forced `run` rejection,
   close once/twice, operation after close, missing tables/columns, and strict
   checking without `skipLibCheck`.
4. **Move lookup and selector lowering.** Implement domain-shaped session row
   selection and `resolve`. Acceptance: IDs, projects, exact/contains directory,
   inclusive lower/exclusive upper time boundaries, empty selectors, latest/only
   resolution, and existing `get-session` outputs and exits are unchanged.
5. **Move title search.** Add title `PatternSet` lowering and call the store from
   `search`. Acceptance: pattern `all`/`any`/`none` API tests pass; current
   positional title terms still mean `all`; order, limit, case sensitivity,
   fixed strings, human output, and JSONL remain byte-identical.
6. **Move V1 content search.** Add V1 normalization and one session-root query.
   Acceptance: each existing positional term maps to a separate member of
   `ContentRequirements.all`, each with singleton `text.all`; this preserves
   independent witnesses, first-term evidence, ordering, limit, and current V1
   tool behavior while removing command deduplication.
7. **Complete bounded boolean lowering.** Implement pattern and requirement
   `all`/`any`/`none` and deterministic evidence. Acceptance: same-witness pattern
   groups, independent requirement witnesses, mixed groups, requirement-level
   `any`, correlated `NOT EXISTS`, no negative evidence, and evidence-disabled
   qualification parity execute against fixtures. No new CLI flags are added:
   current positional syntax remains the compatibility mapping from commit 6.
8. **Add proven V2 text normalization.** Implement user text and assistant
   text/reasoning via `session_message.seq` plus array position. Acceptance:
   native-only and mixed sessions, assistant arrays, stable evidence order,
   explicit exclusions, and real transition fixtures prove the selected
   precedence. Remove the event fallback only after these pass. V2 tool/shell
   requests reject clearly.
9. **Move history with independently proven authority.** Implement per-session
   count policy and separate selection/count cutoffs. Acceptance: V1 fallback,
   V2 native, duplicate, partial/control-only transition, zero-message, recent
   boundary, unlimited `0`, and all existing human/JSONL/TSV outputs pass.
10. **Finish command integration and cleanup.** Make command operations async,
    centralize lifecycle in `finally`, delete `VersionSchema`, old source classes,
    title SQL, and source iteration only when unreferenced. Acceptance: all
    characterization tests are byte-identical; no root command imports Kysely or
    physical schema; strict check passes; representative `EXPLAIN QUERY PLAN`
    shows no unacceptable regression.

### CLI compatibility and bounded booleans

The migration introduces all/any/none in the domain API and live-store lowering
without reinterpreting existing syntax:

```ts
// cotail search alpha beta
requirements: {
  all: [alpha, beta].map((pattern) => ({
    types: [selectedType],
    text: { all: [pattern] },
  })),
}
```

Thus `alpha` and `beta` may still be witnessed by different units, exactly as
today. `--title-only alpha beta` maps to one title `PatternSet.all`, exactly as
today. `-F`, `-s`, `--type`, `--no-snippet`, `--directory`, `--since`, and
`--limit` retain their current parse and output behavior. New CLI syntax for
same-witness groups, OR, and exclusion is out of scope; the executable operation
API proves those semantics first.

### Stop and rejection conditions

Stop the migration and keep the last behavior-preserving commit if any of these
occurs:

- Kysely's selected release or adapter fails the minimum Node 22 read-only test;
- strict project checking requires `skipLibCheck` or pervasive `any` casts;
- representative queries become whole-query raw SQL with Kysely used only as an
  executor;
- real transition fixtures do not support a reliable per-session layout or count
  authority rule;
- V2 extraction cannot make matching and evidence use the same normalized text;
- query plans regress materially and cannot be corrected inside the live store;
- existing CLI output, exit status, ordering, limit, or current V1 semantics must
  change to land the builder; or
- Kysely, physical schema, native handles, or compiled SQL escapes the live-store
  package.

If Kysely is rejected, retain the operation-shaped domain contracts and use the
baseline's private focused SQL. Do not fall through to Drizzle unless a supported
`node:sqlite` driver exists and passes the same runtime, type, and dependency
gates.

## Cross-References

- [`packet-query-builders0.md`](/query/packet-query-builders0.md) defines the
  criteria and non-negotiable semantics scored here.
- [`draft-ksyley1.md`](/query/draft-ksyley1.md) is the selected proposal, narrowed
  by this decision's package and feature gates.
- [`draft-drizzle0.md`](/query/draft-drizzle0.md) supplies the strongest competing
  design and honestly documents its runtime cost.
- [`v2.md`](/v2.md) establishes `session_message`, content variants, and `seq`
  ordering, but does not prove transition precedence.
- [`/.test-agent/query-builders/README.md`](/.test-agent/query-builders/README.md)
  documents both executable experiments and their dependency details.
