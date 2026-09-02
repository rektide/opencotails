---
type: Report
title: Pushdown after action
description: What the source-profile work actually optimized, what remains physically broad, and the next data-access wins to investigate.
resource: /.design/pushdown/after-action0.gpt56s.md
tags: [cotail, pushdown, source-profile, sqlite, history, search, performance, after-action]
status: draft
generated: { by: model:openai/gpt-5.6-sol, at: 2026-09-01T00:00:00Z }
stale_after: 2026-11-01
sources:
  - id: generated-source-profiles
    resource: /.design/pushdown/draft4.gpt56s.md
    title: Generated source profiles and demand-bounded queries
  - id: demand-bounded-operations
    resource: /.design/pushdown/draft3.gpt56s.md
    title: Demand-bounded operation planning with certified access paths
  - id: live-profile-probe
    resource: /.test-agent/profile-live/README.md
    title: Live profile and operation probe
---

# Pushdown After Action

## Executive Answer

The landed profile work primarily **unblocked and de-risked data access**. It did
not, by itself, make the expensive history and direct-search statements
demand-bounded.

It delivered three real improvements:

1. Cotail can understand the current OpenCode source again, including
   `location-switched` Messages.
2. Normal commands no longer scan schema, migration state, indexes, or distinct
   Message types, and no longer invoke OpenCode for version validation. They
   parse a generated profile and trust it.
3. The profile and indexed fixtures now state which physical access paths exist,
   so operation rewrites can make conditional, testable performance claims.

The live evidence after runtime cutover remained intentionally sobering:

- exact Session lookup completed in about 0.9 seconds;
- one-row history took about 12.8 seconds; and
- title-only direct search exceeded a 30-second timeout.

The history plan explained the difference:

```text
MATERIALIZE qualified_sessions
SCAN session_message USING INDEX session_message_session_seq_idx
SEARCH qualified_sessions USING AUTOMATIC COVERING INDEX (sessionID=?)
```

Cotail had logically selected one Session, but SQLite still traversed the full
Message owner index and probed that one-row set. That is the central distinction
of this pushdown work:

> A filter can be in the right semantic stage while the physical loop still
> visits the wrong amount of data.

The selected-root history `CROSS JOIN` repair and the direct-search staged rewrite
are therefore the actual query-optimization phase. They are downstream of, not
substitutes for, trusted source profiles.

## What Landed

### Implementation ledger

| Work | Representative commits | Status |
|---|---|---|
| Profile domain, extraction, capabilities, codec | `8c2cd7c` through `0fa3244` | Landed |
| Explicit generate/show/validate/refresh lifecycle | `e20284d` | Landed |
| Review hardening for selection, process bounds, timestamps, and optional tables | `22b14b0` through `a3a342c` | Landed |
| `location-switched` structured support | `54d8f9b` | Landed |
| Trusted runtime acquisition and removal of startup inspection | `302901e`, `4c068e6`, `bceee21` | Landed |
| Minimal/indexed fixture split and trust-policy regression tests | `587d2de`, `1bea4f8` | Landed |
| Selected-root history and staged direct search | pending operation conformance | In progress |

The table separates enabling infrastructure from operation optimization. Commit
count is not evidence of bounded work; live plans and operation conformance are.

### Source-profile control plane

Cotail now has an explicit `cotail.source-profile/v1` lifecycle:

```text
profile generate  -> inspect executable/database and write deterministic facts
profile show      -> read profile JSON only
profile validate  -> run only explicitly selected checks
profile refresh   -> explicitly regenerate atomically
```

Profiles retain relevant table/column/index facts, observed and supported Message
variants, exact OpenCode version provenance, and derived operation capabilities.
Index capability derivation follows SQLite leftmost-key, collation, direction,
expression, and partial-index rules rather than trusting index names.

### Trusted runtime cutover

Normal commands now:

```text
resolve explicit or conventional profile
    -> strictly decode profile JSON
    -> trust recorded capabilities and supported variants
    -> open recorded database read-only
    -> execute the requested operation
```

They do not:

- invoke `opencode --version`;
- query `sqlite_schema` or PRAGMAs;
- inspect migration markers;
- run `SELECT DISTINCT type`;
- compare profile facts with the current Cotail build;
- validate plans; or
- refresh or discover a fallback source.

This implementation deliberately supersedes draft4 text that proposed a normal
startup version check. Validation is explicit-only.

### Compatibility unblock

`location-switched` is now a first-class, structured-only Message variant. It is
payload-validated and profile-supported but does not invent a searchable
document. This unblocked profile generation against the live database while
preserving the broader open question of how unknown future variants degrade.

### Fixture and proof infrastructure

The tests now distinguish:

- minimal behavior/malformed-source fixtures; and
- production-indexed fixtures suitable for physical plan conformance.

Normal acquisition tests prove trusted profile facts pass through unchanged and
that no schema/index/migration/type/plan inspection occurs. Root fixtures cover
missing, malformed, stale, and executable-sentinel states. This is not user-
visible speed by itself, but it is the evidence boundary needed to optimize
without changing semantics silently.

## What Did Not Land Yet

### Profiles are not query pushdown

A profile records facts and capabilities. It does not move a `WHERE`, choose a
join order, apply a root window, omit hydration, or create an index. Removing a
2-second type-discovery scan helps startup, but it cannot repair a statement that
still scans the full Message relation or expands the complete document world.

### `--since` is logically early but not fully indexed

History and search lower `--since` into a Session predicate before the root
window. Semantically, this is the right side of the frontier: old Sessions cannot
become members later through Message counts or evidence.

However, current OpenCode has no `session_v2` index beginning with
`time_updated`. Its relevant indexes cover primary key, project, workspace,
parent, and suspended state. Therefore:

```text
Session qualification for --since:
  scan candidate Sessions + temporary ordering work
```

The predicate can reduce rows retained and all downstream work, but it cannot
turn Session qualification into a recency range search on the current read-only
source. Making that part asymptotically fast requires an upstream recency index
or a separate Cotail-owned projection/index.

### History was staged but physically inverted

Before the active repair, history already built `qualified_sessions` before
`session_activity`. That prevented unrelated Messages from affecting returned
counts, but the ordinary inner join did not constrain SQLite loop order. The
planner scanned every Message-owner entry and looked up selected Sessions.

The accepted repair changes the aggregate to:

```text
qualified_sessions CROSS JOIN cotail_message
WHERE cotail_message.sessionID = qualified_sessions.sessionID
```

On the indexed profile the target plan is:

```text
MATERIALIZE qualified_sessions
SCAN qualified_sessions
SEARCH session_message ... (session_id=?)
```

That changes Message enrichment from growth with all Messages to growth with the
selected Sessions and the Messages they own. It does not remove Session scanning
or bound one selected Session with extremely high Message fanout.

### Direct search still has a necessary broad frontier

Search cannot simply limit Sessions before checking witnesses: witnesses decide
which Sessions belong in the result. The safe shape is:

```text
Session-only candidate restrictions (--since, directory, cursor)
    -> complete witness qualification
    -> deterministic Session page
    -> selected-Session matching documents
    -> child rank and windows
    -> optional selected-hit payload hydration
```

Candidate predicates can reduce the witness universe, but regex/JSON witness
truth may still require broad document work without an FTS index. The immediate
win is to prevent post-qualification work from remaining broad and to omit
Message payload hydration entirely when evidence is disabled.

Title-only search deserves special attention. A Session title is a root-local
field, yet the current generic document world can still drag in the complete
document relation machinery. The live 30-second timeout suggests either
operation staging or a root-local title path can yield a large practical win
without changing title-search semantics.

A synchronous live probe applied the same case-insensitive JavaScript regex
function directly to `session_v2.title`, retained `(time_updated DESC, id DESC)`
ordering and `LIMIT 1`, and completed in about 0.47 seconds. This is not yet a
production conformance result, but the more-than-30-second versus sub-second
contrast makes root-local specialization a high-value experiment.

## Before And After Cost Model

| Area | Before profile work | After landed profile work | Target after operation repair |
|---|---|---|---|
| Source schema/type discovery | Every normal acquisition | Explicit generation/validation only | Same |
| OpenCode version process | Proposed for normal startup | Explicit generation/validation only | Same |
| Exact Session lookup | Acquisition inspection + PK lookup | Profile parse + PK lookup | Already narrow |
| History Session `--since` | Session scan/order | Session scan/order | Still a residual without recency index |
| History Message counts | Full Message-owner scan could occur | Unchanged by profiles | Selected Session outer loop + owner-key searches |
| Search Session predicates | Applied before witness loop | Unchanged by profiles | Explicit candidate stage before qualification |
| Search witness truth | Broad document qualification | Unchanged by profiles | Still semantically required without search index |
| Search child ranking | Selected roots not fully isolated | Unchanged by profiles | Selected Sessions only |
| Search payload hydration | Joined before final selected hits | Unchanged by profiles | Selected hits only; absent when evidence is off |
| SQL construction | Full logical world per statement | Unchanged | Measure before relation-family seeding |

The important outcome is not “queries are now bounded.” It is that each stage
can now make a narrower, conditional claim and tests can distinguish source
capability, semantic placement, and actual SQLite access.

## Direct Follow-Up Work

### 1. Restore or deliberately revise read-scope snapshot pinning

The runtime cutover removed the prior `sqlite_schema` pin read along with source
inspection. Those concerns are not identical. The accepted standalone execution
design begins a deferred transaction, performs a real read to establish the WAL
snapshot, and only then mints `ReadScopeID`/`observedAt` and publishes the read
scope. The current implementation begins the transaction and mints provenance
without a pin; the first requested statement establishes the actual snapshot
later.

This does not reintroduce startup validation, but it requires a deliberate
contract decision:

- restore a neutral real read while making clear that it proves no schema or
  compatibility fact;
- redesign provenance so it is minted when the first operation statement pins
  the transaction; or
- weaken and document the prior claim that published provenance follows an
  already-established snapshot.

Add a concurrent WAL-writer test that distinguishes these choices. Do not treat
`ReadScopeID`, `observedAt`, `PRAGMA data_version`, or Event watermarks as the
source revision.

### 2. Complete and certify selected-root history

Land the `CROSS JOIN`, preserve all behavior, and require the indexed fixture to
show selected-root outer access plus `SEARCH session_message ...
(session_id=?)`. Re-run the same live one-row history probe and capture the new
plan and timing.

Acceptance should include:

- no Message scan anywhere in the operation plan;
- one qualification materialization;
- unchanged counts, ordering, ties, zero-Message Sessions, and inclusive cutoff;
- unrelated Message growth does not alter the access classification; and
- honest disclosure that Session qualification and selected-root fanout remain.

### 3. Complete direct-search staging

Separate candidate Sessions, witness-qualified Sessions, root page, matching
documents, child windows, and hydration in visible operation-owned CTEs.

The most valuable assertions are:

- `--since`, directory, and cursor restrictions enter the candidate Session
  stage before witness qualification;
- all witnesses still qualify roots before the Session limit;
- document enumeration/ranking after the root page is selected-Session scoped;
- evidence-off SQL contains no `sourceJSON`, Message type, payload join, or
  revision hash inputs; and
- evidence-on payload validation touches selected hits rather than all matching
  candidates.

### 4. Re-run live probes as after-action evidence

Repeat exact lookup, one-row history, title-only search, content search with and
without evidence, and fixed-demand skew probes. Record plans beside timings.
Wall clock remains diagnostic; structural access facts are the gate.

### 5. Promote conformance into explicit plan validation

Once exact operation SQL conforms, make `profile validate --plans` compile and
classify those representative operations. Do not generate certificates before
the operation and runtime pair actually passes. Keep this explicit and outside
normal startup.

## Further Optimization Space

### A. Session recency access path

**Problem:** `--since` cannot avoid a Session scan/order because OpenCode lacks a
`(time_updated, id)` access path.

**Experiments:**

1. Add a production-shaped `(time_updated DESC, id DESC)` index only to a copied
   fixture and compare plans/scaling.
2. Propose the index upstream if it benefits OpenCode’s own history/listing
   operations.
3. If upstream ownership is unsuitable, design a Cotail-owned Session projection
   only after defining refresh, revision, privacy, and relocation policy.

**Expected win:** true recency range search plus deterministic order, reducing
root qualification from a complete Session scan to the selected time range.

### B. Root-local search specialization

**Problem:** title-only search uses the generic document/witness machinery even
though title belongs directly to Session.

**Experiments:** compile and explain a direct root-title predicate against the
generic document form, preserving the same result/evidence product. Measure
whether a small operation branch removes document-union construction and JSON
work. The first direct live probe completed in about 0.47 seconds while the
generic command exceeded 30 seconds. Directory-only or current-location search
may share this root-local class.

**Expected win:** large latency reduction for metadata-only searches without an
FTS sidecar.

### C. Candidate restriction propagation through document branches

**Problem:** generic `cotail_document` is a union over many Message-derived
families. A Session candidate predicate may not be pushed into every branch
equally by SQLite.

**Experiments:** classify each relevant union branch under a fixed candidate
Session set; count payload validator calls; inspect whether owner equality is
present before JSON expansion. Move candidate identity into branch-local joins
only where the plan demonstrates a problem.

**Expected win:** witness work follows candidate Sessions for indexed owner
access, while preserving semantically necessary witness truth.

### D. Evidence-off statement specialization

**Problem:** consumers that only need matching Session roots should not pay for
excerpts, source JSON, payload hashes, or revision decoding.

**Experiment:** compare compiled SQL, payload-validation count, VM/plan facts, and
wall clock for identical searches with evidence on/off.

**Expected win:** lower JSON decoding, I/O, hashing, and output work; no change to
root qualification cost.

### E. Child fanout and truthful totals

**Problem:** after selecting a Session page, one Session can still own a very
large number of matching Documents or Messages. Exact totals require visiting
that fanout before a child window.

**Options:**

- retain exact totals and name fanout as residual;
- add an explicit “no total” or approximate-total product mode;
- impose query budgets with a typed partial-result outcome;
- maintain Cotail-owned aggregates if a real consumer justifies them.

**Expected win:** bounded tail latency, but only through an explicit product
contract change rather than accidental pushdown.

### F. Relation-family seeding

**Problem:** simple operations still compile the complete logical CTE world,
including unrelated JSON-heavy relations.

**Experiment:** measure compile, SQLite prepare, and first-step time separately
for exact lookup, history, title search, and content search. Prototype Session,
Message, and Document family seeds only if statement construction remains
material after operation rewrites.

**Expected win:** lower parse/prepare cost and clearer plans. This is statement
construction optimization, not row-access pushdown.

### G. Cotail-owned FTS or aggregate sidecars

**Problem:** regex and JSON witness qualification has no upstream text index;
exact counts and broad search remain proportional to relevant source content.

**Precedence:** stabilize direct-search semantics, source identity, access
policy, revision/rebuild behavior, and measurements first.

**Expected win:** indexed candidate generation and ranking. **Cost:** persistent
derived data, incremental maintenance, deletion/privacy policy, relocation, and
rebuild correctness. This is a separate product, not a free extension of source
profiles.

### H. Product-specific combined operations

**Problem:** separate history, search, and evidence calls repeat root
qualification when one consumer needs all three over the same page.

**Direction:** add a combined product operation only for a concrete consumer,
establishing one root page and deriving required facets from it. Do not create a
generic automatic operation composer.

**Expected win:** shared qualification and one read snapshot where the product
actually needs it.

### I. Prepared execution and long-lived hosts

**Problem:** a one-shot CLI repeatedly parses profiles, constructs SQL, opens a
connection, and prepares statements.

**Direction:** after row-access and statement-shape work is measured, evaluate a
long-lived watch/host process with cached profile parsing and prepared operation
families. Keep profile refresh explicit and invalidate caches only through
declared lifecycle actions.

**Expected win:** lower fixed per-command overhead for interactive repeated use;
little effect on broad scans.

## Measurement Matrix

Every proposed win should identify the dimension it claims to reduce:

| Probe | Hold fixed | Grow | Intended observation |
|---|---|---|---|
| History owner pushdown | selected Sessions and their Messages | unrelated Sessions’ Messages | no Message scan; stable selected-owner access |
| `--since` recency path | returned recent Sessions | old Sessions | recency index search rather than Session scan |
| Direct-search candidate propagation | candidate Sessions and matches | excluded Sessions/documents | branch-local owner searches where available |
| Evidence omission | qualifying roots and child ranks | payload size | no hydration SQL or validator calls when off |
| Selected-root fanout | root page size | one selected root’s children | expose honest remaining growth |
| Relation seeding | result and source rows | unused logical families | lower compile/prepare time, same access plan |
| FTS sidecar | query/result semantics | source document count | indexed candidate growth and exact live recheck |

Use behavioral equality and structural plans as load-bearing gates. Use wall
clock to compare practical alternatives, not to prove semantics. Add a native
VM/full-scan work counter if Node exposes one without changing statement shape.

## Recommended Near-Term Game

The immediate game is not “push every filter as low as possible.” It is:

1. Name the result root and everything that can change its membership/order.
2. Apply safe root-local restrictions such as `--since`, directory, and cursor
   before related qualification.
3. Complete witness qualification before any root limit when witnesses determine
   membership.
4. Window roots once membership/order are complete.
5. Drive enrichment, child ranking, and hydration from those selected identities.
6. Omit optional work entirely when the product does not request it.
7. Prove the physical access path on a recorded indexed profile.
8. State remaining scans and fanout dimensions honestly.

Profiles solved the “what source facts may this operation trust?” question. The
operation rewrites answer “what identities should drive each expensive stage?”
Plan conformance answers “did SQLite actually honor that construction?” Storage
indexes or sidecars answer the remaining cases where correct stage placement
still has no efficient access path.

## Cross-References

- [Generated source profiles and demand-bounded queries](/.design/pushdown/draft4.gpt56s.md)
  defines the profile lifecycle and separates source facts from operation-owned
  query construction. Its normal version-check text is superseded by the
  explicit-only trust policy recorded here.
- [Demand-bounded operation planning](/.design/pushdown/draft3.gpt56s.md)
  defines candidate, qualification, window, enrichment, and hydration frontiers
  plus the accepted history construction and cost envelopes.
- [Live profile exercise](/.test-agent/profile-live/README.md) records the real
  generated profile, explicit validation, before/after startup probes, and the
  pre-repair history plan.
- [Cotail development ideas](/.design/ideas/ideas.gpt56s.md) places plan
  certificates, relation-family seeding, access policy, sidecar search, source
  catalog, transcript, watch, and bookmarks in a broader value/precedence map.
