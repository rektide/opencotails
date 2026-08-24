---
type: Prompt
title: The implicit question of the pushdown wave
description: Neutral restatement of what the .design/pushdown wave is actually asking, the open questions and tensions at stake, and the criteria an acceptable answer must meet — without endorsing any candidate direction.
resource: /.design/pushdown/prompt0.glm53.md
tags: [cotail, query, pushdown, qualification, prompt, tensions]
status: draft
generated: { by: model:glm53, at: 2026-08-29T00:00:00Z }
stale_after: 2026-11-29
sources:
  - id: pushdown-brief
    resource: /.design/pushdown/draft0.gpt56.md
    title: Qualification pushdown handoff brief (draft0)
  - id: draft1-gpt56
    resource: /.design/pushdown/draft1.gpt56.md
    title: Qualification staging and bounded enrichment (draft1, gpt-5.6)
  - id: draft1-glm53
    resource: /.design/pushdown/draft1.glm53.md
    title: Pushdown contract and pinned-loop enrichment (draft1, glm53)
  - id: draft1-oxa2
    resource: /.design/pushdown/draft1.oxa2.md
    title: Pushdown discipline assessment and forward plan (draft1, oxa2)
---

# The Implicit Question Of The Pushdown Wave

## What Is Up

Cotail's V2 query world is real: logical `cotail_*` relations over OpenCode's
SQLite projections, a read-only Kysely world, one-read scoped execution, and a
first generation of canonical operations (lookup, list, history, direct
search). During the canonical history rewrite, a review found that the query
counts Messages for **every Session ever persisted** before the outer query
discards the groups that do not belong to the small, qualified Session page.
The query is type-safe, behaviorally correct, and test-covered. Its work is on
the wrong side of an aggregation barrier anyway.

Commit `c3e02b37` landed a qualified-Session CTE candidate into
[`history.ts`](/packages/query-kysely/src/operations/history.ts), explicitly
not accepted as architecture. The `cotail-session-report-history` ticket is
gated on `cotail-query-pushdown-design`: no history decision until Cotail has a
general discipline. The pushdown wave was opened to produce that discipline:

- [`draft0.gpt56.md`](/.design/pushdown/draft0.gpt56.md) — the handoff brief
  framing the failure class, the conditional-pushdown rule, the audit table,
  and four candidate interface directions;
- three independent draft1s —
  [`draft1.gpt56.md`](/.design/pushdown/draft1.gpt56.md),
  [`draft1.glm53.md`](/.design/pushdown/draft1.glm53.md),
  [`draft1.oxa2.md`](/.design/pushdown/draft1.oxa2.md) — each assessing
  draft0, adding evidence, and proposing a contract and forward plan.

All three draft1s executed fixture probes against the same engine (Node 26.6.0
/ SQLite 3.53.3) with authoritative upstream indexes. They agree on the
central physical finding — the current history shape scans every Message row —
and they disagree on at least one load-bearing experimental result (see
[tension 2](#tension-2-the-planner-is-not-a-contract)). This document does not
adjudicate. It restates what the wave is asking so the next round — synthesis,
fresh drafts, or implementation decisions — starts from the question rather
than from any one draft's answer.

## The Implicit Question

Every draft circles one question, stated most compactly in draft1.glm53:

> When may root qualification, ordering, and windowing safely precede related
> aggregation or hydration — and what physical loop structure and conformance
> evidence make that placement provable rather than asserted?

Unpacked, it is three braided questions that only look like one:

1. **Semantic.** For a given operation, which related-row work may be moved
   after the root page is chosen, and which must complete before it because it
   determines membership, rank, order, or cursor continuation?
2. **Physical.** Given SQLite's actual planner behavior, which construction of
   the staged query produces work proportional to the selected page rather
   than to the whole related relation — and how do we know, rather than hope?
3. **Institutional.** How does a project *guarantee* the right placement
   operation after operation and engine version after engine version — through
   interface shape, tests, review, benchmarks — without replacing the Kysely
   query world that produced the problem in the first place?

The triggering bug is the semantic and physical questions in miniature. The
open design is the institutional question at full size.

## Key Questions

These are live. Each has candidate answers in the wave; none is settled by
consensus of the drafts, and this document deliberately does not rank them.

1. **What is the unit of classification?** Is related work classified per
   computation (qualifying / enriching / hydrating), per operation, or per
   stage? Is there a decision procedure an operation author can *apply* —
   draft1.oxa2 proposes "removing it can change roots, order, rank, or cursor
   continuation" — or is classification necessarily judgment, checked only at
   review?
2. **What evidence is load-bearing?** The wave names five layers — compiled-SQL
   shape assertions, `EXPLAIN QUERY PLAN` fragments, work-count probes,
   bounded-growth fixtures, wall-clock benchmarks. Which layer carries the
   guarantee, and which are advisory? What happens to each when SQLite or Node
   bumps a version?
3. **Where does enforcement live?** Interface shape, conformance tests, review
   checklist, benchmarks — which guarantee is carried by which mechanism? What
   proportion of machinery is justified by two and a half staged operations?
4. **When is abstraction legitimate?** All three draft1s defer shared builders
   and typed stage vocabularies, but the revisit triggers differ (a third
   conforming operation; two consumers with identical semantics; repeated
   qualification boilerplate). Is duplication a safety feature — the reason a
   limit may move stays visible — or a debt to be paid down at a defined
   moment?
5. **What is the accepted history rewrite?** Pinned join, IN-seeded aggregate,
   correlated fallback, or some mix — and with what keyset semantics, what fate
   for `--limit 0`, and what happens to the "one grouped aggregate" acceptance
   criterion inherited from the session-report pass if the bounded shape does
   not preserve it?
6. **How honest is the boundedness promise?** Session-side qualification is
   O(all Sessions) regardless — upstream has no `time_updated` index and Cotail
   opens sources read-only. Does the contract promise per-stage boundedness,
   total boundedness, or named residual costs? Must planned but unimplemented
   operations (FTS, lineage, watch, bookmarks, events) inherit the contract,
   and can they, given they cannot yet provide implementation evidence?
7. **Does the discipline reach the logical world?** Draft0 and draft1.oxa2 both
   flag [`world.ts`](/packages/query-kysely/src/relations/world.ts) — unions,
   JSON expansion, validation functions, full-world CTE seeding — as places
   where predicate propagation may silently die. This is asserted in every
   draft and verified in none. Is auditing it part of this wave or a separate
   follow-up?

## Tensions

What is actually at stake, in the sense that a wrong resolution in either
direction costs something real.

### Tension 1: Correctness proves nothing about cost

The founding observation of the wave: a query can be semantically correct,
type-safe, and fully test-covered while doing work proportional to everything
ever persisted. The converse trap also exists — an operation can be physically
tight while silently moving a limit across work that *does* affect membership
or order. The two properties are independent:

```mermaid
flowchart TB
  SEM["Semantic stage order<br/>(operation-owned, behaviorally tested)"]
  PHYS["Physical boundedness<br/>(fixture-proven, plan/probe tested)"]
  PASSING["Green tests today"]
  PASSING -->|"proves neither"| SEM
  SEM ~|"independent —<br/>either can hold alone"| PHYS
```

Every layer of this design exists because green tests today prove neither. An
acceptance regime that tests only one of the two re-creates the bug class on
the other axis.

### Tension 2: The planner is not a contract

The sharpest factual disagreement in the wave: the IN-seeded aggregate is
**bounded** in draft1.oxa2's probe (`SEARCH session_message … (session_id=?)`
driven by `LIST SUBQUERY`) and **unbounded** in draft1.glm53's (full Message
scan probing the materialized qualified list) — same engine version, both
fixtures claiming authoritative indexes. Both observations can be true across
fixtures and compilation paths; which is which is unresolved.

The general tension underneath: any fix that depends on the planner choosing a
loop order is stable only until it isn't. The proposed mitigations themselves
conflict:

- pin loop order syntactically (a documented planner constraint, but still a
  planner behavior that a future version may honor differently);
- assert plan fragments (fails loudly on drift, but plan text is
  version-sensitive wording);
- assert bounded growth by scaling fixtures (honest about the property we
  actually want, but timing-based versions are flaky in CI and probe-based
  versions risk changing the plan they measure).

Choosing what to trust here is choosing what kind of failure the project
prefers: silent regression, noisy CI, or instrumentation that lies.

### Tension 3: General rule now vs local repair now

History is blocked on the general design; the general design is being written
because history regressed. The wave must decide what "accepted" means for a
discipline proven on one and a half operations. Accept too early and the
contract ossifies around history's shape (enrichment-only) before meeting a
qualifying-frontier operation (direct search) or a rank-driven one (future
FTS). Accept too late and every new operation ships unbounded until the
eschaton of the design. Where the acceptance line sits — and whether it gates
per-operation or project-wide — is undetermined.

### Tension 4: Visibility vs machinery

The wave's four interface directions (operation-private staged CTEs, reusable
qualified-root builder, typed stage vocabulary, conformance-only) are really
one axis: how much of the reasoning about *why a limit may move* stays visible
in each operation's code versus being encoded in shared interfaces or types.
Visibility duplicates; machinery hides. The drafts converge toward the visible
end *for now* — but the history regression was itself caused by an inherited
aesthetic criterion ("one grouped aggregate") outranking physical outcomes,
which is a warning that *any* codified shape preference, including "staged
CTEs," can become tomorrow's false virtue. The rule and its evidence must stay
about work, not about SQL text.

### Tension 5: Whose guarantee is it anyway

Kysely cannot know which relation is the result root or which predicates
qualify. SQLite cannot know Cotail's product semantics. `LogicalRead` owns
snapshot and provenance but pointedly not work placement. So the operations
own it — but "the operations own it" is a slogan until it names a mechanism:
an interface that makes misplacement unwritable, a test that makes it fail, a
checklist that makes it reviewable, or some division among all three. The
split of guarantees across mechanisms is the actual institutional design, and
each draft1 proposes a slightly different split.

### Tension 6: Instrumentation changes the thing measured

Work-count probes (test-only SQLite functions counting visited rows) are the
most direct evidence available, but a probe injected into a join can alter the
plan it measures; wall-clock scaling tests are plan-neutral but noisy and
slow; growth ratios hide constant factors. There is no free instrument. Which
imperfection is tolerated, where, and with what tolerance, is open — and it
interacts with tension 2, since the more the guarantee leans on fixtures, the
more the fixtures must be honest about indexes, schema revision, and scale.

## Where The Drafts Already Converge

Recorded so the next round does not re-litigate. These are observations
reported independently by the drafts, not endorsements by this document:

- the current history shape visits every Message row despite joining a
  qualified-Session CTE (all three probes);
- root-first windowing is safe only when related work cannot affect root
  membership, order, rank, or cursor (all four documents);
- direct search is prior art for a qualifying frontier that legitimately
  precedes the window;
- the seam is operation construction plus conformance, not a second query
  algebra or a promise of automatic optimizer pushdown (draft0's constraint,
  honored by all draft1s);
- behavioral equality of a rewrite is necessary and insufficient; some
  physical evidence is required;
- Session-side qualification cost is a separate, currently unbounded upstream
  fact that should be reported separately, not conflated with the Message-side
  regression;
- no shared builder or stage types without repeated implemented consumers.

## What We Are Looking For

Inferred from the wave as a whole, an acceptable resolution would:

1. give an operation author a way to *place* related work relative to
   qualification/order/window and to *justify* that placement, per operation,
   in terms a reviewer can check;
2. make bounded work **provable** — by evidence stable enough to survive
   supported engine versions, with a stated position on which evidence layer
   is load-bearing and which is advisory;
3. preserve the existing authorities intact: one `LogicalRead` snapshot and
   provenance per operation, Kysely as the query language, no second query
   algebra, physical relations staying behind logical ones;
4. unblock `cotail-session-report-history` with a rewrite that is *accepted*,
   not merely plausible — including what happens to inherited shape criteria
   that conflict with boundedness;
5. name its residual costs honestly (Session-side qualification, planned
   operations without evidence yet) rather than implying total boundedness;
6. say when it would be revisited — what future evidence (a third staged
   operation, a planner change, an upstream index) should reopen which part.

A next round may deliver this as a synthesis of the three draft1s, as fresh
independent drafts against this prompt, or as direct implementation of the
history decision — but the deliverable is judged against the questions above,
not against proximity to any existing draft.

## Research Prompt For The Next Round

> In Cotail's Kysely-over-SQLite query world, determine when root
> qualification, ordering, and windowing may safely precede related-row
> aggregation or hydration, and what conformance evidence (plan fragments,
> work-count probes, bounded-growth fixtures, benchmarks) makes that placement
> provable rather than asserted — including reconciling the wave's conflicting
> probe results on the IN-seeded aggregate, deciding which evidence layer is
> load-bearing across engine versions, choosing how much interface machinery
> two and a half staged operations justify, and specifying the accepted
> history rewrite without letting inherited SQL-shape criteria or any single
> draft's preference settle the question.

## Cross-References

- [Pushdown brief (draft0)](/.design/pushdown/draft0.gpt56.md) — the handoff
  that opened the wave; source of the audit table and interface directions.
- [draft1.gpt56](/.design/pushdown/draft1.gpt56.md),
  [draft1.glm53](/.design/pushdown/draft1.glm53.md),
  [draft1.oxa2](/.design/pushdown/draft1.oxa2.md) — the three independent
  answers this prompt abstracts from; their agreements and conflicts are
  catalogued above.
- [V2 relational query world](/.design/query/design3.gpt56.md) — the authority
  split (arbitrary logical queries vs operation-owned products) any discipline
  must police from the operation side.
- [Scoped query execution](/.design/query2/design2.gpt56.md) — the one-read
  snapshot and provenance guarantees all stages must preserve.
- [Canonical Session operation pass](/.design/session-report/full-query-pass0.gpt56.md)
  — source of the history product and the "one grouped aggregate" criterion
  whose fate tension 4 concerns.
- [History implementation](/packages/query-kysely/src/operations/history.ts)
  and [direct search](/packages/query-kysely/src/operations/direct-search.ts)
  — the two live operations the discipline must first govern.
- [Logical relation world](/packages/query-kysely/src/relations/world.ts) —
  the unaudited barrier surface named in key question 7.
- Probes: [.test-agent/pushdown](/.test-agent/pushdown) (glm53) and
  [.test-agent/pushdown-oxa2](/.test-agent/pushdown-oxa2/README.md) — the
  conflicting evidence of tension 2.
