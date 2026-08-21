---
type: Design
title: Qualification pushdown contract and pinned-loop enrichment
description: Independent assessment of draft0 plus fixture-verified SQLite/Kysely evidence, a contract for qualifying versus enriching work, and a sequenced forward plan anchored on a Kysely-native cross-join repair for history.
resource: /.design/pushdown/draft1.glm53.md
tags: [cotail, query, pushdown, qualification, sqlite, kysely, history, performance]
status: draft
generated: { by: model:glm53, at: 2026-08-21T00:00:00Z }
stale_after: 2026-10-21
sources:
  - id: pushdown-brief
    resource: /.design/pushdown/draft0.gpt56.md
    title: Initial qualification-pushdown handoff brief
  - id: parallel-draft
    resource: /.design/pushdown/draft1.gpt56.md
    title: Parallel draft1 from a prior session (read for coordination, claims re-derived here)
  - id: relational-query-world
    resource: /.design/query/design3.gpt56.md
    title: V2 relational query world
  - id: execution-design
    resource: /.design/query2/design2.gpt56.md
    title: Scoped query execution
  - id: session-operation-pass
    resource: /.design/session-report/full-query-pass0.gpt56.md
    title: Canonical Session reporting and operation redesign
  - id: watch-observability
    resource: /.design/watch/database-observability0.gpt56t.md
    title: Watch database observability baseline
  - id: current-history
    resource: /packages/query-kysely/src/operations/history.ts
    title: Current canonical history operation
  - id: history-conformance
    resource: /packages/query-kysely/test/history.test.ts
    title: Current history SQL and plan assertions
  - id: direct-search
    resource: /packages/query-kysely/src/operations/direct-search.ts
    title: Current direct-search operation
  - id: opencode-session-schema
    resource: https://github.com/anomalyco/opencode/blob/9306ac690be70904f73d92fec6b16b2a7a9a436c/packages/core/src/session/sql.ts
    title: Authoritative OpenCode session and message schema (commit 9306ac69)
  - id: sqlite-optimizer
    resource: https://www.sqlite.org/optoverview.html
    title: SQLite query planner overview, including the CROSS JOIN ordering constraint
  - id: plan-experiments
    resource: /.test-agent/pushdown/history-plan.ts
    title: Executable fixture, tap-probe, and variant experiments backing this draft
---

# Qualification Pushdown Contract And Pinned-Loop Enrichment

## Situation

Cotail's V2 query world is implemented: logical `cotail_*` relations over
OpenCode's SQLite projections, a read-only Kysely world, scoped one-read
execution, and a first generation of canonical operations (lookup, list,
history, direct search). The canonical history rewrite replaced two correlated
count subqueries with one grouped aggregate. An independent review then found
that the aggregate's work is not bounded by the qualified Session page, and
`cotail-query-pushdown-design` (P0) was opened: design the general
qualification/order/window/hydration discipline before accepting or editing
history. Commit `c3e02b37` landed a qualified-Session CTE candidate that is
semantically staged but had not been proven physically bounded.

This draft is an independent `draft1` for the pushdown wave, written beside
[`draft1.gpt56.md`](/.design/pushdown/draft1.gpt56.md) for a later synthesis
pass. Its distinguishing input is executable evidence: a fixture carrying the
authoritative upstream indexes, `EXPLAIN QUERY PLAN` reproductions of the
current shape, a tap-function probe that counts Message rows each shape
actually visits, repair variants tested at two data scales, and a
Kysely-native repair query that compiles through the logical world, typechecks
under `tsgo --strict`, and produces the bounded plan. All numbers below come
from [`history-plan.ts`](/.test-agent/pushdown/history-plan.ts) on SQLite
3.53.3 (Node 26.6.0 `node:sqlite`); outputs are captured in
[`output.txt`](/.test-agent/pushdown/output.txt).

Research prompt for the wave: when may root qualification, ordering, and
windowing safely precede related aggregation or hydration, and what physical
loop structure and conformance evidence make that placement provable rather
than asserted?

## Assessment Of Draft0

### What draft0 gets right

- **The failure class is work placement, not missing indexes.** A query can be
  type-safe, behaviorally correct, and tested while putting related-row work on
  the wrong side of an aggregation barrier. Draft0 states this cleanly.
- **Pushdown is conditional.** Root-first windowing is safe only when related
  rows are attached facets; when related rows determine membership, rank, or
  order (witnesses, FTS rank, `HAVING`, descendant predicates), they must be
  evaluated before the window. Draft0's safe/unsafe split is the correct rule
  and matches the two implemented frontiers (history enriches; direct search
  qualifies through documents).
- **The seam is operations plus conformance, not a second query algebra.** The
  warning against inventing a parallel AST or promising automatic optimizer
  pushdown is right, and the four interface candidates it lists are the right
  comparison set.
- **Three layers of evidence** (compiled SQL, query plans, work counts) are all
  required because returned-row equality proves nothing about cost.
- The audit table is the right coverage list, and direct search is correctly
  identified as prior art for staged qualification.

### What is stale, unproven, or now answerable

- **The handoff is mid-flight.** Draft0 addresses a reader deciding whether to
  accept `c3e02b37`; that candidate is now the implemented
  [`history.ts`](/packages/query-kysely/src/operations/history.ts). The
  question is no longer "which local rewrite" but "is the current shape
  physically bounded, and if not, which minimal change makes it so."
- **Draft0's verification checklist left every physical question open.** It
  asked whether SQLite "materializes or co-routines the CTE in a way that
  actually restricts Message access" — this draft answers that empirically:
  no. SQLite materializes `session_activity`, scans the entire Message owner
  index as the aggregate's outer loop, and probes the qualified set per row.
- **One candidate in draft0's space is empirically dead.** Seeding the
  aggregate with `session_id in (select sessionID from qualified_sessions)`
  does not flip the loop order; SQLite still scans every Message and probes
  the materialized list. Anything downstream of draft0 that lists the IN-form
  as a live repair option should stop doing so.
- **"One grouped aggregate" was inherited as a virtue and caused the
  regression.** The pre-canonical correlated shape was never the physical
  problem — two indexed correlated subqueries are bounded (verified below).
  The canonical pass's "one aggregate" goal is a SQL-text aesthetic; the
  contract must not reify it. It *can* still be honored while restoring
  boundedness, which matters because
  [`cotail-session-report-history`](/.design/session-report/full-query-pass0.gpt56.md)
  has "one grouped aggregate computes counts" as acceptance criteria.
- **Textual SQL assertions are not plan evidence.** Draft0's compiled-SQL
  layer is useful for semantic barriers, but the current history test proves
  only that the aggregate *mentions* `qualified_sessions`. The corrected
  acceptance bar is about loop order and access method.
- Draft0's ten scope questions are good but had no decision procedure. They
  are answered concretely below rather than re-opened.

## Fresh Evidence

### Fixture and probe method

The shared test fixture creates `session_v2` and `session_message` with **no
secondary indexes**. The authoritative schema at
[commit `9306ac69`](https://github.com/anomalyco/opencode/blob/9306ac690be70904f73d92fec6b16b2a7a9a436c/packages/core/src/session/sql.ts)
defines on `session_message` a unique `(session_id, seq)` index,
`(session_id, type, seq)`, `(session_id, time_created, id)`, and
`(time_created)`, and on `session_v2` only project/workspace/parent/partial-
suspended indexes — **no `(time_updated, id)` index exists upstream**. The
experiments add the authoritative indexes, plant 3 qualified Sessions (12
Messages total, one Session with zero Messages) plus 300 unrelated Sessions,
and scale unrelated Messages from 100 to 1000 each (30,012 → 300,012 total
Message rows).

A deterministic `tap()` SQL function is injected into each variant's join or
filter expression so it returns its argument unchanged while counting Message
rows the shape actually visits. Plans are printed for every variant, probed
and unprobed.

### The current shape is unbounded, exactly as feared

Compiling the real `sessionHistoryQuery` through the package on the indexed
fixture:

```text
MATERIALIZE session_activity
SCAN session_message USING INDEX session_message_session_seq_idx
SEARCH qualified_sessions USING AUTOMATIC COVERING INDEX (sessionID=?)
```

SQLite materializes the aggregate as a standalone subquery, chooses the
Message table as its outer loop, and probes the small qualified set once per
Message row. The join predicate prevents unrelated Messages from
*contributing* groups; nothing prevents them from being *visited*. The
operation's cost grows with every Message ever persisted.

### Variant results

| Variant | Aggregate loop structure | taps @ 30k | taps @ 300k | ms @ 300k |
|---|---|---:|---:|---:|
| A — current shape (physical inner join) | SCAN messages → probe qualified | 30,012 | 300,012 | ~80 |
| B — `IN (select … qualified)` seed | SCAN messages → probe LIST SUBQUERY | 30,012 | 300,012 | ~67 |
| C — CROSS JOIN pin (physical) | SCAN qualified → SEARCH messages `(session_id=?)` | **3** | **3** | ~0.2 |
| D — two correlated subqueries (pre-canonical) | 2× CORRELATED SCALAR SUBQUERY, indexed SEARCH | **6** | **6** | ~0.1 |
| E — CROSS JOIN pin through `cotail_message` CTE | SCAN qualified → SEARCH messages `(session_id=?)` | **3** | **3** | ~0.2 |

All variants return identical rows, including the zero-Message Session.
Findings:

1. **The IN-seed does not work** (B). SQLite keeps Message as the driving
   loop and probes the materialized qualified list. This closes one of
   draft0's open candidate directions with a negative result.
2. **CROSS JOIN pinning works, including through the logical relation** (C,
   E). SQLite documents that `CROSS JOIN` constrains the planner from
   reordering tables
   ([optoverview](https://www.sqlite.org/optoverview.html)); driving from the
   qualified page turns the join constraint into an indexed owner probe
   (`SEARCH session_message … (session_id=?)`), and the `cotail_message` CTE
   flattens into the join without blocking the pin.
3. **The correlated control is bounded** (D). The original correlated shape
   was physically fine; the regression arrived with canonicalization. D costs
   one extra probe per Session per count and would conflict with the history
   ticket's "one grouped aggregate" criterion, so it is the fallback, not the
   recommendation.
4. **Without indexes, the pinned join still does not regress** (checked with
   a no-index fixture): SQLite builds an `AUTOMATIC COVERING INDEX
   (session_id=?)` — one transient build pass, then owner probes — while the
   current shape full-scans. Realistic fixtures remain necessary for honest
   plan conformance, but the repair is safe even where indexes are absent.
5. **Session-side qualification is a separate, upstream cost.** Every variant
   (and the current operation) scans `session_v2` and uses a temp B-tree for
   order, because upstream has no `(time_updated, id)` index. Bounded Message
   enrichment does not fix this, and claims/tests must report the two costs
   separately.
6. **Every compiled statement carries all twelve logical CTEs.** Kysely does
   not prune unreferenced `with` entries, so the seeded world ships the entire
   `cotail_document` union (and friends) in each statement's text; SQLite
   ignores unreferenced CTEs in the plan but pays parse cost per `prepare`.
   Not a pushdown blocker; recorded as a future world-seeding concern.

### The Kysely-native repair

Kysely's `crossJoin` takes no `ON` clause, so the pin is expressed as
`crossJoin` plus a `where` equality — semantically an inner join, physically
an order constraint:

```ts
.with("session_activity", (qb) => qb.selectFrom("qualified_sessions")
  .crossJoin("cotail_message")
  .where((eb) => eb("cotail_message.sessionID", "=", eb.ref("qualified_sessions.sessionID")))
  .select((eb) => [
    "cotail_message.sessionID",
    eb.fn.countAll<number>().as("messagesTotal"),
    sql<number>`sum(case when ${eb.ref("cotail_message.createdAt")} >= ${since} then 1 else 0 end)`
      .as("messagesSince"),
  ])
  .groupBy("cotail_message.sessionID"))
```

Compiled through the package's logical world this produces:

```text
MATERIALIZE session_activity
SCAN qualified_sessions
SEARCH session_message USING COVERING INDEX session_message_session_time_created_id_idx (session_id=?)
```

with correct counts, surviving zero-Message Sessions, and no physical table
names escaping the logical relations. The construction typechecks under
`tsgo --strict`. The rest of the operation (predicate, order, limit in
`qualified_sessions`; left join back for zero counts; final deterministic
order) is unchanged from the current implementation.

## Contract

### Result root and work classes

Every domain operation names a **result root**: the identity whose membership,
order, and page size the product promises. Related work is classified
operation-by-operation, not syntactically:

- **Qualifying work** can change root membership, rank/cursor values, or page
  membership (witness existence, FTS rank, `HAVING`, descendant predicates,
  aggregate-derived order). It must complete before root windowing. It may be
  broad; breadth is then a semantic cost, not a bug.
- **Required enrichment** contributes result fields to already-selected roots
  and cannot alter membership or order (history Message counts, child usage
  totals after a parent page is fixed). It must consume selected root IDs
  through an owner-restricted path whose physical plan starts from, or index-
  probes by, those IDs.
- **Optional hydration** loads values absent in some result mode (evidence
  payloads when evidence is off). The SQL branch should omit the source joins
  and columns for the mode, unless measured to be negligible.

### Two independent acceptance properties

- **Semantic stage order** (operation-owned): moving the root window across
  related work cannot change the returned product. This is a property of the
  operation's declared semantics, tested behaviorally.
- **Physical boundedness** (fixture-proven): for a fixed selected page,
  post-window enrichment and hydration work does not grow proportionally with
  unrelated related rows. This is a property of the SQLite plan, tested by
  loop/access assertions and (where cheap) row-visit counts.

An operation is accepted only when both hold. A query that satisfies the
first while scanning every Message satisfies neither the spirit of the
contract nor the letter of the second.

### Evidence rules

- Compiled-SQL assertions may check semantic barriers (stage order, owner
  restriction present, no escaped physical names) but are never proof of loop
  order.
- Plan assertions are local and version-tolerant: require an owner-keyed
  `SEARCH … (session_id=?)` (or equivalent) for enrichment inner loops;
  reject `SCAN <related physical or logical relation>` and repeated
  correlated scans over unwindowed roots; do not snapshot whole plans.
- Fixtures must reproduce authoritative upstream indexes, and the supported
  upstream schema revision must be recorded next to them. Runtime source
  validation currently checks tables and columns but not indexes; index
  expectations belong to source-adapter compatibility, not the logical API.

## Decisions

| Direction (draft0's list) | Verdict | Reason |
|---|---|---|
| Operation-private staged CTEs | **Adopt** | Stage reasons stay visible per operation; Kysely inference intact; exact SQL testable |
| Reusable qualified-root builder | Defer | One and a half staged operations exist; premature interface work; revisit after a third conforms |
| Typed stage vocabulary | Reject for now | Types cannot prove limit movement or SQLite plans; risks a custom algebra |
| Conformance-only discipline | Insufficient | Review cannot see loop order; tests must carry it |

Physical mechanism decision: **where post-window enrichment joins related rows
by owner key, express the join as a CROSS JOIN pin (`crossJoin` + `where`
equality) so the selected root page drives indexed owner probes.** This is
documented SQLite planner behavior, not an undocumented trick; it is
semantically an inner join; it is expressible in Kysely without raw SQL
escape; and it preserves "one grouped aggregate" where that shape is wanted.
It is a plan directive and must be guarded by plan conformance so a future
planner change that regresses the loop fails tests. Where the pin cannot be
expressed, indexed correlated aggregates are the accepted bounded fallback;
the `IN`-seeded aggregate is not acceptable. Qualifying frontiers (direct
search) are exempt from pinning — their related work legitimately precedes
the window and may scan.

## Answers To Draft0's Scope Questions

1. **Result root declaration** — prose + review convention naming the root
   per operation, not a type; the root is not always the first `selectFrom`.
2. **Qualification stages** — `qualified_*` CTEs own predicate, deterministic
   order, cursor, and page; nothing post-window may feed them.
3. **Qualifying vs enriching vs hydrating** — classified per the contract
   above, recorded in the operation's checklist entry.
4. **Restricting enrichment to the page** — owner-keyed consumption via
   CROSS JOIN pin (or correlated fallback), never outer-join discard.
5. **One LogicalRead** — stages stay CTEs in one statement; provenance and
   snapshot semantics are untouched.
6. **Helpers** — none extracted yet; candidates (keyset predicate, plan-test
   utilities) wait for a second consumer with identical semantics.
7. **Plan/work evidence** — loop/access assertions on indexed fixtures plus
   optional tap-probe counts; wall-clock benchmarks are trend-only.
8. **Violations today** — history (physically unbounded enrichment); direct
   search (correct frontier; unproven post-window behavior and evidence-off
   hydration); arbitrary logical queries make no boundedness promise.
9. **CTE seeding and materialization** — SQLite materializes multi-reference
   CTEs (`qualified_sessions` twice, the aggregate once) and flattens single-
   reference logical CTEs into the join; the CROSS JOIN pin survives
   flattening; the full-world seeding cost is a separate future concern.
10. **Enforcement split** — interface shape (stages visible, products typed),
    tests (behavioral equality + plan invariants + work growth), review
    (checklist), benchmarks (trend detection only).

## Forward Plan

### 1. Make fixtures tell the truth

Add the authoritative `session_message` and `session_v2` indexes to the
shared V2 fixture with the supported upstream revision recorded (currently
`9306ac69`). Add a failing history plan assertion: enrichment must contain
`SEARCH session_message … (session_id=?)` and must not contain
`SCAN session_message`. Keep the known `session_v2` scan/sort visible and
unrelated to this regression.

*Exit: the current implementation fails the new assertion for the right
reason on indexed fixtures.*

### 2. Rewrite history's aggregate as a pinned join

Replace the `innerJoin` in `session_activity` with the verified
`crossJoin` + `where` shape above; change nothing else. Correct the
operation's comments to distinguish rows *excluded from grouping* (old
wording) from rows *never visited* (new reality). Keep all behavioral tests;
parameters and ordering are unchanged.

*Exit: behavior identical (including zero-Message Sessions and limit/cutoff
semantics), aggregate subtree shows owner-keyed searches, existing SQL-shape
assertions still pass except where they asserted the inner join spelling.*

### 3. Add work-growth evidence

Pair fixtures with the same qualified page and growing unrelated Messages
(10×, 100×). Assert the plan invariant from step 1 on both, and where a
tap-style probe can be injected plan-neutrally, assert visited-row counts do
not grow. Keep a wall-clock benchmark for trend detection only. Report
Session-qualification cost separately from Message-enrichment cost.

*Exit: fixed-page history work is insensitive to unrelated Message volume by
plan assertion, and by probe count where available.*

### 4. Update the trackers

Append this evidence to `cotail-query-pushdown-design`; record the accepted
contract and pinned-join mechanism. Move `cotail-session-report-history` from
"blocked on design" to "implementing the accepted repair" — its "one grouped
aggregate" criterion is preserved by step 2. Do not close history until steps
1–3 land.

*Exit: both tickets reflect the decision and the remaining implementation
work.*

### 5. Audit direct search on its own terms

Its qualifying frontier (witnesses over `cotail_document`) is legitimately
pre-window; do not force the pinned idiom there. Verify instead: owner
restrictions propagate through the unioned/JSON-expansion CTEs into
`matching_documents`; measure whether witness predicates are evaluated twice
(qualification and evidence) and whether that is plan-visible or inherent;
branch the SQL when `evidence` is false so `sourceJSON`, payload-hash inputs,
and other hydration-only columns are absent from the statement.

*Exit: direct search has documented qualifying cost and mode-appropriate
post-window work, without coupling to the history repair.*

### 6. Codify the checklist; defer abstraction

Add a short contributor checklist beside the operations (name the root; list
membership/order inputs; classify each related computation; justify limit
movement; show owner restriction inside post-window work; attach behavioral,
plan, and — where related rows can dominate — work-growth evidence). Extract
a shared builder only after a third staged operation exhibits the same stage
with the same semantics.

*Exit: checklist merged; no new generic interface introduced.*

## Acceptance Gates

- History behavior unchanged; enrichment plan is owner-keyed searches driven
  by the qualified page; `IN`-seeded and plain inner-join forms are rejected
  by tests.
- Indexed fixtures with recorded upstream revision are the plan-conformance
  baseline.
- Fixed-page work-growth tests are insensitive to unrelated Message volume.
- Direct search documents its qualifying frontier and omits hydration-only
  work when evidence is disabled.
- The contributor checklist exists; no builder/stage types without two
  implemented consumers beyond history.
- Planned operations (FTS, lineage/child usage, fork, bookmarks, events,
  watch) inherit the contract by citing it, and are not blocked on it.

## Cross-References

- [Initial pushdown brief](/.design/pushdown/draft0.gpt56.md) — assessed
  above; its conditional root-first rule and anti-AST stance are carried
  forward, its open physical questions are closed with evidence.
- [Parallel draft1 (gpt-5.6)](/.design/pushdown/draft1.gpt56.md) — reached
  independently before this draft; corroborates the unbounded current plan
  and the staged-conformance direction. This draft adds the IN-variant
  negative result, the verified Kysely cross-join spelling, index-less
  fallback behavior, and pre-canonical-correlated vindication; a synthesis
  pass should reconcile the two forward plans.
- [V2 relational query world](/.design/query/design3.gpt56.md) — the two
  authority levels (arbitrary logical queries vs operation-owned products)
  this contract polices from the operation side.
- [Scoped query execution](/.design/query2/design2.gpt56.md) — the one-read
  snapshot and provenance guarantees that all stages must preserve.
- [Canonical Session operation pass](/.design/session-report/full-query-pass0.gpt56.md)
  — source of the "one grouped aggregate" history criterion that the pinned
  join preserves.
- [Watch database observability baseline](/.design/watch/database-observability0.gpt56t.md)
  — earlier empirical note that correlated indexed counts were bounded;
  variant D reconfirms it.
- [Current history implementation](/packages/query-kysely/src/operations/history.ts)
  and [its conformance test](/packages/query-kysely/test/history.test.ts) —
  the code and assertions this plan modifies.
- [Direct search implementation](/packages/query-kysely/src/operations/direct-search.ts)
  — the qualifying-frontier counterpart audited in step 5.
- [Executable evidence](/.test-agent/pushdown/history-plan.ts) — fixture
  builder, variant suite, tap probe, and Kysely repair; outputs in
  [`output.txt`](/.test-agent/pushdown/output.txt).
