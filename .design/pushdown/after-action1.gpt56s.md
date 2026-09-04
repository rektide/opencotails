---
type: Report
title: Pushdown after action, post-repair
description: Current accounting of trusted profiles, demand-bounded operations, live gains, the content-search validation fix, and the remaining access-path frontier.
resource: /.design/pushdown/after-action1.gpt56s.md
tags: [cotail, pushdown, source-profile, sqlite, history, search, performance, after-action]
status: draft
generated: { by: model:openai/gpt-5.6-sol, at: 2026-09-04T00:00:00Z }
stale_after: 2026-12-04
sources:
  - id: first-after-action
    resource: /.design/pushdown/after-action0.gpt56s.md
    title: Pushdown after action before operation completion
  - id: live-reprobe
    resource: /.design/pushdown/live-reprobe0.glm53.md
    title: Live post-repair probe and content-search OOM
  - id: materialization-probe
    resource: /.design/pushdown/materialization0.glm53.md
    title: Document-union validation redundancy probe
  - id: intent-audit
    resource: /.design/pushdown/intent-audit0.glm53.md
    title: Draft4 intent versus landing audit
---

# Pushdown After Action, Post-Repair

## Executive Answer

Cotail did more than unbreak the current OpenCode database. The work landed in
three layers, and the distinction matters:

1. **Compatibility and trust:** generated profiles moved schema, index, version,
   and Message-variant inspection out of normal commands.
2. **Query construction:** history, search, title search, and recent activity now
   put bounds at explicit semantic frontiers and drive later work from selected
   identities.
3. **Physical access:** indexed fixture plans and live measurements prove that
   several metadata operations now avoid the broad Message work that made them
   unusable.

The live 20.9 GB database confirms real gains:

| Operation | Before | Post-repair |
|---|---:|---:|
| One-row 24-hour history | 12.8 s after profile cutover | 1.5 s |
| Title-only search | exceeded 30 s | 1.2 s |
| Finite Message tail | not implemented | 1.1 s |
| One-shot Message watch | not implemented | 1.1 s |

Those metadata timings are now mostly process startup and profile decoding. The
selected-root history join and root-only title operation are genuine query
optimizations, not merely compatibility repairs.

Content search is less complete. Its semantic staging and Message-time range
pushdown landed, but the first live re-probe exposed a separate multiplicative
cost: the JavaScript payload validator ran about seven times per in-range
Message through the document union and exhausted a 4 GB V8 heap. Commit
`e24298d8` removes strict validation from witness qualification and retains it at
selected evidence hits. A post-fix 7-day live search returned five rows in 76
seconds instead of OOMing; a 30-day no-snippet search returned five rows in 4
minutes 36.68 seconds. That closes the catastrophic heap-growth mechanism, but
SQL-native JSON expansion is still too slow to call content search fast.

The game is therefore no longer “put a `WHERE` somewhere earlier.” It is:

> Establish the identities and ranges that may affect truth, window only after
> truth is complete, drive optional work from the narrowest selected identities,
> and prove that SQLite uses the intended access path without hiding residual
> scans or fanout.

## What Actually Landed

### Trusted source facts, not startup discovery

Normal commands strictly decode one selected profile and trust its database
locator, supported variants, and capabilities. They do not invoke OpenCode,
inspect SQLite schema/indexes/migrations/content, validate plans, refresh, or
fall back to discovery. Explicit `profile generate`, `refresh`, and selected
`validate` checks own inspection.

This removed recurring fixed work and made source assumptions reviewable. It did
not itself alter operation SQL.

### Selected-root history

History now constructs one ordered and optionally limited `qualified_sessions`
page, then uses that page as the outer input to Message aggregation:

```text
qualified_sessions
  CROSS JOIN cotail_message
  WHERE cotail_message.sessionID = qualified_sessions.sessionID
```

On the indexed profile, conformance requires:

```text
SCAN qualified_sessions
SEARCH session_message ... (session_id=?)
```

and rejects `SCAN session_message`. Message counting now grows with selected
Sessions and their Messages, not unrelated Messages in the database. Total and
recent counts remain exact, zero-Message Sessions remain visible, and the final
order remains `(updatedAt DESC, sessionID DESC)`.

### Staged direct search

Direct search now exposes the intended frontiers in operation-owned CTEs:

```text
candidate_sessions
  -> witness_qualified_sessions
  -> selected_sessions
  -> matching_documents
  -> ranked_documents / session_totals
  -> selected_hits
  -> hydrated_hits (evidence only)
```

This preserves the central semantic rule: every witness must qualify a Session
before the Session page limit. After that limit, selected Sessions drive document
ranking and selected hits drive revision-payload hydration. Evidence-off SQL
omits `hydrated_hits`, payload revision joins, hashing inputs, and strict
selected-hit validation.

It does **not** omit all payload-derived work. Content matching necessarily reads
JSON and projects searchable text unless an independent search index supplies
candidates. The correct evidence-off claim is:

> No JavaScript strict validator and no selected-hit revision hydration; SQL
> JSON shape checks and text projection remain qualification costs.

### Message-created range pushdown

Content search can rebuild its logical world with a half-open Message-created
range. The lower bound reaches the physical `session_message.time_created`
selection before document projection. Indexed tests require `SEARCH
session_message ... time_created` and reject physical Message scans for bounded
forms.

This is real `--since` pushdown. It reduces the Message universe before JSON
work, but the size of the requested window still matters.

### Root-only title search

Title-only search no longer uses the generic document union. It queries Session
columns directly and, only when explicit `--since` activity is requested, adds a
metadata-only Message-existence range. It performs no payload reads or
validation. The live result improved from more than 30 seconds to 1.2 seconds.

### Metadata-only tail and watch

The root/message world now has a relation family that does not select physical
payload data. `tail` performs a `time_created` index range with deterministic
top-N ordering. `watch` repeatedly samples that same finite view and truthfully
reports newly visible observations, not durable causal events.

## What `--since` Means Now

`--since` is not one universal domain predicate. Each command must name the
clock and the membership effect it uses.

| Command | Meaning |
|---|---|
| Content search | Inclusive Message `time_created >= cutoff`; only in-range Messages can witness a match. There is no default cutoff. |
| `search --since-updated` | Exact Session `updatedAt >= cutoff`, plus a Message-created backfill beginning 21 days before the cutoff by default. The backfill can miss older matching content; `off` restores exhaustive Message history. An explicit `--since` wins when it is stricter. |
| Title-only search | `--since-updated` is an exact Session predicate. Explicit `--since` requires at least one Message in range but the title itself remains root-local. |
| History | One inclusive cutoff has two roles: Session `updatedAt` controls root membership, while Message `createdAt` controls `RECENT`; `TOTAL` still covers all Messages owned by selected Sessions. Default 31 days. |
| Tail | Inclusive Message-created cutoff resolved once; newest 50 by default. |
| Watch | The same top-N Message-created view; relative cutoffs move each sample while ISO cutoffs remain fixed. Default 31 days. |

This answers the original `--since` question precisely:

- For content search, the Message-created range is physically pushed into an
  indexed source selection before JSON projection.
- For title search, tail, and watch, the operation avoids payload projection
  altogether.
- For history, Message enrichment is selected-owner indexed, but Session recency
  qualification is not.
- `--since-updated` can bound content work only by accepting an explicit backfill
  false-negative policy.

## The Remaining `--since` Floor

The live OpenCode schema has no Session index beginning with `time_updated` and
continuing with `id`. Therefore history and updated-Session search still scan
and order candidate Sessions even though their predicate is semantically early.
The profile cannot manufacture an access path.

Three honest options remain:

1. Propose an upstream `(time_updated DESC, id DESC)` index if OpenCode itself
   benefits from recency listings.
2. Accept the current Session scan while the population is small and measure its
   growth independently of Message work.
3. Build a Cotail-owned projection only when source identity, refresh,
   relocation, deletion/privacy, and revision policy justify persistent state.

Writing an index into OpenCode's database is not an option; normal access remains
read-only and `query_only`.

## Content-Search Failure And Fix

### Why staging was insufficient

The staged search correctly delayed root windows and evidence hydration, but the
generic document world still fed each document branch from a strictly validated
Message CTE. SQLite inlined that CTE through roughly seven branches. On a
production-shaped fixture, 240 in-range Messages caused 1,680 JavaScript
validator calls. At live payload sizes around 27 KB, a 7-day window exhausted
V8's heap before qualification completed.

This was a multiplicative cost envelope the original conformance tests did not
assert:

```text
window Messages x document-union branches x payload bytes
```

### Current policy

Direct-search qualification now uses shape-only projection:

- SQLite `json_valid`, `json_type`, `json_extract`, and `json_each` determine
  whether a row can produce a document.
- Syntactically malformed and branch-incompatible payloads produce no documents.
- Evidence-off search performs zero strict JavaScript validations.
- Evidence-on search strictly validates selected Message-owned hits before
  returning excerpts and revision hashes.
- A guard-compatible but otherwise schema-incomplete payload can qualify a root
  without evidence, while evidence mode fails if that payload is selected. This
  is deliberate and regression-tested, not an accidental equivalence claim.

Default arbitrary logical-world content queries remain strict. Shape-only mode
is selected by the direct-search operation that owns the hydration boundary.

### Current measured result

The exact post-fix 7-day command that previously OOMed now completes and returns
five rows:

```sh
cotail search sqlite --since 7d --limit 5 --json
```

Measured wall time was 76.21 seconds. The 30-day no-snippet probe was interrupted
by an agent-server restart but continued in the background and completed with
five rows in 4 minutes 36.68 seconds:

```sh
cotail search sqlite --since 30d --limit 5 --no-snippet --json
```

The fix therefore passes both live OOM regression windows. It does not make
broad JSON search interactive.

## Current Cost Envelopes

| Operation | Dominant work now | Residual |
|---|---|---|
| Exact Session lookup | One primary-key Session probe | Process/profile fixed cost |
| History | Session qualification/order, then selected-owner Message probes | No Session recency index; selected Session fanout |
| Title search | Session predicate/match/order; optional indexed Message-activity existence | No Session title or recency index |
| Tail/watch sample | Indexed Message-created range and finite order/limit | Top-N observation can miss churn between samples |
| Bounded content search | Indexed Message-created range, repeated SQL JSON projection, complete witness truth | Window size, union width, witness count, matching fanout |
| Unbounded content search | Complete Message/document qualification | Fundamentally broad without an index |

“Bounded” always means bounded by one of these dimensions, not by returned row
count alone.

## Direct Follow-Up Work

### 1. Make SQL-native search projection single-pass and requested-family aware

The P1 validator fix removes V8 heap churn, but the 76-second 7-day result leaves
the core search product slow. Reframe `cotail-search-document-projections` around
reusable canonical projection seeds selected by declared witness fields:

- default text should instantiate only user/synthetic/system/skill and assistant
  text branches;
- reasoning and tool modes should instantiate only their required families;
- independent witnesses should reuse one projected candidate relation rather
  than repeat JSON expansion;
- full-world fallback should remain available for undeclared programmatic
  witnesses;
- row parity, nested identities, attachment offsets, ordering, and exposure must
  stay canonical.

The target is zero strict qualification validations plus one SQL JSON projection
per eligible Message/family, not the stale `R` strict-validation target currently
written in that ticket.

### 2. Re-run live content probes after projection work

Record 7-day and 30-day content searches with and without snippets, including
wall time, peak memory if available, result equality, query plans, and strict
validator-call counts. A timeout is a result; do not raise the heap and call that
an optimization.

### 3. Decide whether profiles describe or govern access

Profiles currently record two equality/order capabilities. Operations transport
but do not consult them. The load-bearing Message-created range used by search,
tail, and watch cannot be expressed, and plan certificates decode but are never
generated or validated.

Choose one explicit direction:

1. Extend the requirement language with range and covering properties, make one
   recent-activity tracer consume it, and implement explicit certificate
   generation/validation; or
2. Treat capabilities as generated documentation, remove the inert certificate
   promise in the next profile schema, and keep physical conformance in indexed
   operation tests.

### 4. Restore snapshot/provenance truth

`openRead` begins a deferred transaction and mints provenance before a real read
pins the WAL snapshot. Existing tests prove consistency after the first
statement, not pin-before-publication. Restore a neutral read before provenance,
mint provenance at the first successful statement, or weaken the contract
explicitly. This is not startup source validation and should not be conflated
with the no-inspection policy.

### 5. Finish compatibility degradation and error rendering

First-class `location-switched` support fixed the known compatibility break, but
future unknown Message variants can still fail explicit profile generation.
Define visible degraded completeness rather than repeatedly adding emergency
variants. At the CLI boundary, render tagged structured errors so no operational
failure exits with blank stderr.

## Further Wins

### Root-local search family

Title specialization proved the class. Session location, model, agent, slug,
parent, and other root-local fields should use Session-only operations rather
than generic documents. Preserve one deterministic paging contract, but do not
force unrelated fields through JSON-heavy relations.

### Search core completion

After requested-family projection is fast enough, expose already-modeled shell
and compaction fields, multi-type selection, same-document conjunction,
negation, and the existing keyset cursor. Do not widen the document consumers
before fixing their projection cost.

### Relation-family seeding

Exact lookup and metadata operations now demonstrate the benefit of constructing
only Session or Session+Message worlds. Generalize this by domain family when a
real operation needs it; avoid a generic planner. The primary win is lower SQL
parse/prepare complexity and fewer irrelevant JSON branches.

### Cotail-owned FTS

Direct JSON search remains proportional to the requested content universe even
after single-pass projection. Ranked interactive search eventually requires a
Cotail-owned FTS candidate index with explicit source identity, access policy,
freshness/checkpoint, deletion/privacy, rebuild, over-fetch, and authoritative
live recheck semantics. Direct regex and FTS are different search languages and
must remain visibly distinct.

### Work budgets and observability

Track the dimensions that caused this failure: Messages in scope, projected
families, JSON bytes, witnesses, selected roots, selected hits, and strict
validations. Add typed budget outcomes where interruption is real; do not claim
hard cancellation around synchronous SQLite stepping. Traces must redact terms,
parameters, and payloads.

### Long-lived execution

Once row access and statement shape are repaired, a long-lived host can cache
profile decoding and prepared operation families to remove the remaining
one-second command floor. It will not rescue broad scans and should follow, not
precede, content-search projection work.

## Recommended Order

1. Keep `e24298d8`'s zero-validation qualification policy and update the P1 issue
   acceptance language to match what content search can truthfully omit.
2. Implement requested-family, single-pass SQL document projection; re-probe 7d
   and 30d live content search.
3. Resolve snapshot publication correctness.
4. Decide whether capabilities/certificates become operational or shrink.
5. Complete unknown-variant degradation and never-silent error rendering.
6. Then expand search modes and root-local fields.
7. Pursue FTS only after source identity and access policy are explicit.

## Cross-References

- [First after-action](/.design/pushdown/after-action0.gpt56s.md) captures the
  state before history/search completion and is retained as historical context.
- [Live post-repair probe](/.design/pushdown/live-reprobe0.glm53.md) proves the
  metadata gains and records the original content-search OOM.
- [Document-union materialization probe](/.design/pushdown/materialization0.glm53.md)
  isolates the seven-times validator multiplier and compares statement shapes.
- [Draft4 intent audit](/.design/pushdown/intent-audit0.glm53.md) identifies the
  inert capability/certificate vocabulary and source-catalog omissions. Its
  “no post-repair probe” statement predates and is superseded by the live report.
- [Search core completion draft](/.design/search/draft0.glm53.md) inventories
  field modes and combinators; projection performance should precede that scope.
- [Cotail development ideas](/.design/ideas/ideas.gpt56s.md) places FTS, source
  identity, policy, reporting, watch, and hosted execution in a wider roadmap.
