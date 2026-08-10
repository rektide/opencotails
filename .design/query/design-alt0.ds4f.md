---
type: Design
title: Match-first plan architecture
description: Alternative query architecture making content units the query root, selection a single relation-tagged constraint value, and compilation a named two-stage plan shared by direct and FTS backends.
resource: /query/design-alt0.ds4f.md
tags: [cotail, query, search, architecture, sqlite, fts]
status: draft
generated: { by: model:opencode-go/deepseek-v4-flash, at: 2026-08-10T01:26:08Z }
sources:
  - id: design-prompt
    resource: /query/prompt0.gpt56sol.md
    title: Cotail query architecture design prompt
  - id: current-query-types
    resource: /src/opencode/types.ts
    title: Current content query and result types
  - id: current-content-query
    resource: /src/opencode/source.ts
    title: Current direct content-query compiler
  - id: current-history-query
    resource: /src/opencode/session.ts
    title: Current history query
  - id: current-search-command
    resource: /src/commands/search.ts
    title: Current title SQL and content-query wiring in the search command
  - id: project-readme
    resource: /README.md
    title: Cotail behavior and planned FTS architecture
---

# Match-first Plan Architecture

## Wave note

This is the `design-alt` wave: an independent alternative to `draft0.gpt56sol.md`,
written without consulting that file's conclusions beyond the shared prompt and
current source. It is intentionally *not* a refinement of the draft. Where the
draft centers the **session** and grows a session-oriented envelope with
selection and requirements as siblings, this design centers the **content unit**
and derives sessions as the grouping target. The two should be read side by side;
this document cross-references the draft only in the alternatives section.

## Situation

Cotail's query behavior is currently spread across four SQL builders with
divergent shapes:

- `buildTitleQuery` in `src/commands/search.ts:30` — session-row criteria only,
  `re(?, title)` AND'd, scope clauses appended inline.
- `buildContentQuery` in `src/opencode/source.ts:21` — one correlated `EXISTS`
  subquery per pattern, snippet from `patterns[0]`, scope clauses appended.
- `countActiveSessions` in `src/opencode/session.ts:11` — time + directory scope
  with aggregate count projections, hand-assembled.
- `latestSessionByDirectory` / `getSessionById` in `src/opencode/session-info.ts`
  — exact-match directory and id lookups (note: **exact** directory match here,
  **contains** match in search/history; the same word means two different things
  already).

The pattern to observe: every builder re-implements the same scope plumbing
(updated-time, directory), and content matching exists only inside
`buildContentQuery`, parameterized by `VersionSchema` fragments for V1/V2.

The README plans a second backend (FTS index owned by cotail) whose natural query
unit is a *content row* in an FTS virtual table, not a session row. Today that
phase looks like a fork because the only query artifact is SQL aimed at the
opencode DB. The question is whether a query model exists where direct and FTS
are two lowering of the *same* selection, rather than two commands that happen to
share a name.

## Thesis

The root object of a cotail query is not a session. It is the **searchable
corpus of content units** (parts in V1, part events in V2, indexed rows in FTS).
A query **selects sessions**, but it does so by constraining two relations — the
session row and its related content units — and then **grouping matched content
back into sessions**. Sessions are the projection target; content is the match
target. This is the only framing in which FTS is not a second, differently-shaped
dialect: FTS matches units natively, and grouping units to sessions is exactly
what the index already stores (`parts_fts.session_id`).

From that framing, three commitments follow:

1. **One selection value, one constraint vocabulary, relation-tagged.**
   `Selection` is a bounded AND-list of `Constraint`s. Every constraint declares
   the relation it ranges over (`on: "session"` or `on: "content"`). Directory,
   updated-time, project, id, and title are all session-row constraints; content
   matching is a content-unit constraint. There is no separate `SessionSelection`
   and `ContentSelection`: content criteria *participate* in selection, and the
   planner decides which side each constraint lands on.

2. **One `TextMatch` concept.** Title matching and content matching are the same
   idea applied to different relations. A match is a closed union of kinds
   (`regex` now; `phrase` and FTS-native forms later). Matching a title is just a
   `TextMatch` bound to the session row.

3. **Quantification is explicit and bounded.** By default each content constraint
   is independently existential (a session qualifies if *some* unit matches each
   constraint — the current `EXISTS`-per-pattern behavior, now named). A `group`
   key on constraints says several matches must be satisfied by **the same unit**.
   This is the escape hatch for "one part must contain both patterns", and it
   does not require a generic predicate AST.

The whole design then compiles through a **named two-stage plan**: `plan`
(semantic query + backend descriptor → structured plan stages) and `execute`
(plan + db → normalized results). The plan is the test seam and the FTS port
unit; pushdown is an explicit stage-ordering inside planning, not a magic property
of SQL.

## Domain model and vocabulary

- **Content unit** — the atomic searchable thing: a `part` row (V1), a
  `message.part.updated.1` event (V2), or an FTS row. It carries a type
  (`text` / `reasoning` / `tool`), text, and an ordering key.
- **Session** — the grouping target and projection unit. One session aggregates
  many content units.
- **Relation** — `"session"` (a session row) or `"content"` (the session's
  related units). Constraints and matches are bound to a relation.
- **Constraint** — a bounded criterion over one relation. Conjunction at the
  selection level; existential quantification for content.
- **Selection** — the AND-list of constraints a session must satisfy.
- **TextMatch** — a closed union of matching semantics (`regex`, later `phrase`,
  later FTS-native). Reliable across relations.
- **Projection** — what to return per session: summary fields, evidence, or a
  closed aggregate. Never a filter.
- **Evidence** — a projection bound to a *named* content constraint: the unit
  that satisfied it, first-by-ordering, truncated.
- **Backend** — a passive storage descriptor (V1, V2, FTS) exposing relation
  expressions and a capability set. Backends do not own queries.
- **Plan** — the structured, ordered lowering of a `SessionQuery` for one
  backend: scope / match / evidence / projection / order / limit stages.
- **Execute** — run a plan against a database and normalize rows.

## Proposed module interface

The query module is deep and its interface is four names, two of which callers
normally touch:

```ts
export interface SessionQuery {
  selection: Selection;
  projection: Projection;
  order: Order;
  limit: number;
}

export function querySessions(db: DatabaseSync, query: SessionQuery): SessionResult[];

export function plan(query: SessionQuery, backend: Backend): Plan;
export function execute(plan: Plan, db: DatabaseSync): SessionResult[];
```

`querySessions` is the convenience seam commands use; it detects the backend,
then `plan` + `execute`. `plan` is the named test seam and the FTS port unit —
exported, typed, closed, but only reached for tests, backend porting, and plan
caching. The `{ sql, bindings }` object stays a private detail of a direct
`execute`.

The module owns: source detection, relation partition, pushdown ordering, V1/V2
expression fragments, SQL assembly, named binding, execution, result
normalization, and deduplication policy. Command files shrink to
parse → build `SessionQuery` → `querySessions` → render.

### Module layout

```text
src/
  query/
    types.ts               SessionQuery, Selection, Constraint, TextMatch,
                           Projection, Evidence, Order, SessionResult
    plan.ts                plan(): partition + stage ordering
    execute.ts             execute(): direct SQL execution, row normalization
    backends/
      direct.ts            DirectBackend (V1/V2 expressions), detectBackend
      fts.ts               (future) FTSBackend: MATCH + bm25 + snippet
  commands/
    search.ts              parse CLI, build SessionQuery, querySessions, render
    history.ts             parse CLI, build SessionQuery (counts projection), render
  opencode/
    db.ts                  discovery, read-only open, re() registration
    session-info.ts        get-session: build a tiny SessionQuery for one id/dir
```

Backend lives under `query/` because it is a *query* concept (storage shape as
seen by the planner), not an opencode-db concept.

## Example types

```ts
export type Relation = "session" | "content";

export interface Selection {
  requireEvery: readonly Constraint[];
  requireAny?: readonly Constraint[]; // future OR, defined in migration step 13
}

export type Constraint =
  // session-row constraints
  | { id: string; on: "session"; kind: "sessionId"; value: string }
  | { id: string; on: "session"; kind: "projectId"; value: string }
  | { id: string; on: "session"; kind: "directoryContains"; value: string }
  | { id: string; on: "session"; kind: "updatedIn"; range: TimeRange }
  | { id: string; on: "session"; kind: "titleMatch"; match: TextMatch }
  // content-unit constraints
  | {
      id: string;
      on: "content";
      group?: string;              // same unit must satisfy all grouped constraints
      contentType: "text" | "reasoning" | "tool";
      match: TextMatch;
      role?: "user" | "assistant"; // declared; waits on V1/V2 provenance research
    };

export interface TimeRange {
  fromInclusive?: number;
  beforeExclusive?: number;
}

export type TextMatch =
  | { kind: "regex"; pattern: string; caseSensitive: boolean }
  | { kind: "phrase"; phrase: string; caseSensitive: boolean }; // direct: escaped adjacency
// future: | { kind: "fts"; expression: string }   FTS-native MATCH

export type Projection =
  | { kind: "summary"; evidence?: Evidence }
  | { kind: "counts"; messages: { recentWithinMs: number } }; // history

export interface Evidence {
  forConstraint: string;   // named constraint id, not a positional index
  firstBy: "created";      // future: "rank" under FTS
  maxCharacters: number;
}

export interface Order {
  by: "updated";           // future: "rank" (FTS)
  direction: "descending" | "ascending";
}

export interface SessionResult {
  id: string;
  slug: string;
  title: string;
  directory: string;
  timeCreated: number;
  timeUpdated: number;
  evidence?: { snippet?: string };
  // history: counts
  messagesRecent?: number;
  messagesTotal?: number;
}
```

Deliberately absent: generic field references, an arbitrary `and`/`or` predicate
tree, an open projection list, backend names inside the query, and any claim that
regex and FTS share matching semantics.

The `id` on every constraint is load-bearing: evidence binds to a *named*
constraint, groups reference ids, and tests refer to constraints by id. This
replaces the current "snippet always drawn from `patterns[0]`" positional magic
with a named reference the CLI sets to the first content constraint.

## Query model: three worked values

### 1. Session-only (history)

```ts
const query: SessionQuery = {
  selection: {
    requireEvery: [
      { id: "s1", on: "session", kind: "updatedIn", range: { fromInclusive: cutoff } },
      { id: "s2", on: "session", kind: "directoryContains", value: "/src/compfuzor" },
    ],
  },
  projection: { kind: "counts", messages: { recentWithinMs: 86_400_000 } },
  order: { by: "updated", direction: "descending" },
  limit: 0, // unlimited
};
```

### 2. Title search

Title is a `TextMatch` bound to the session relation — the same concept as
content, different `on`:

```ts
const query: SessionQuery = {
  selection: {
    requireEvery: [
      { id: "t1", on: "session", kind: "titleMatch",
        match: { kind: "regex", pattern: "compaction", caseSensitive: false } },
      { id: "t2", on: "session", kind: "updatedIn", range: { fromInclusive: cutoff } },
    ],
  },
  projection: { kind: "summary" },
  order: { by: "updated", direction: "descending" },
  limit: 50,
};
```

### 3. Multi-pattern content (the headline case, now explicit)

```ts
const query: SessionQuery = {
  selection: {
    requireEvery: [
      { id: "c0", on: "content", contentType: "text",
        match: { kind: "regex", pattern: "opencode", caseSensitive: false } },
      { id: "c1", on: "content", contentType: "text",
        match: { kind: "regex", pattern: "journal", caseSensitive: false } },
    ],
  },
  projection: { kind: "summary", evidence: {
    forConstraint: "c0", firstBy: "created", maxCharacters: 200 } },
  order: { by: "updated", direction: "descending" },
  limit: 50,
};
```

The semantics are now readable from the value: two independent existential
content requirements (different units may satisfy them), snippet drawn from the
unit satisfying `c0`, ordered by `created`. Nothing here is a side effect of SQL
shape.

## The two-stage plan

`plan(query, backend)` produces an ordered, closed value:

```ts
export type Plan =
  | DirectPlan   // stages + SQL fragments bound to a direct backend
  | FtsPlan;     // future: MATCH expression, joins, bm25, snippet()
```

A `DirectPlan` records the planner's decisions explicitly:

```ts
interface DirectPlan {
  kind: "direct";
  stage: {
    scope: {           // session-row predicates, cheapest first
      indexed: SqlFragment[];   // equality on id / project_id (source indexes)
      scanned: SqlFragment[];   // updatedIn, directoryContains
    };
    match: {           // content-unit grouping
      perUnit: SqlFragment[];   // one correlated EXISTS per group
    };
    evidence?: SqlFragment;
    projection: SqlFragment;
    order: SqlFragment;
    limit: SqlFragment;
  };
  bindings: Record<string, string | number | null>;
}
```

`SqlFragment` is a private `{ sql: string; uses: string[] }` shape; the plan
publishes *structure*, not the SQL string soup. Tests assert the stage shapes
("scope has one scanned predicate", "match has two perUnit clauses", "evidence
binds constraint c0"), never the SQL text.

The partition is the planner's first act: sort `requireEvery` by relation and by
cost, so pushdown is a *visible, testable ordering* rather than an emergent
property. Indexed equality constraints (`sessionId`, `projectId`) go first;
scanned session constraints next; content constraints become `perUnit` EXISTS;
evidence is derived from the named constraint.

## Lowering to direct SQLite

All examples lower against V1 (`part p`); V2 differs only in the backend
descriptor's expressions, never in the query value.

### Scope stage

```ts
{ id: "s1", on: "session", kind: "updatedIn", range: { fromInclusive: 1786000000000, beforeExclusive: 1787000000000 } }
{ id: "s2", on: "session", kind: "directoryContains", value: "/src/compfuzor" }
```

lowers to:

```sql
WHERE s.time_updated >= $s1_from AND s.time_updated < $s1_before
  AND instr(s.directory, $s2) > 0
```

`sessionId` and `projectId` emit `s.id = $…` / `s.project_id = $…`, which the
source schema can index; `updatedIn` and `directoryContains` still scan session
rows but prune before any content evaluation. The plan names this honesty:
scanned predicates are recorded as `scanned`, and the module promises nothing
stronger.

### Match stage — independent existential (current semantics, named)

```ts
{ id: "c0", on: "content", contentType: "text", match: { kind: "regex", pattern: "opencode", caseSensitive: false } }
{ id: "c1", on: "content", contentType: "text", match: { kind: "regex", pattern: "journal", caseSensitive: false } }
```

lowers to two `perUnit` clauses:

```sql
AND EXISTS (
  SELECT 1 FROM part p
  WHERE p.session_id = s.id
    AND json_extract(p.data, '$.type') = $c0_type
    AND re($c0_pattern, json_extract(p.data, '$.text'))
)
AND EXISTS (
  SELECT 1 FROM part p
  WHERE p.session_id = s.id
    AND json_extract(p.data, '$.type') = $c1_type
    AND re($c1_pattern, json_extract(p.data, '$.text'))
)
```

### Match stage — same-unit group

Give both constraints `group: "g"` and the planner emits **one** EXISTS holding
both predicates:

```sql
AND EXISTS (
  SELECT 1 FROM part p
  WHERE p.session_id = s.id
    AND json_extract(p.data, '$.type') = $c0_type
    AND re($c0_pattern, json_extract(p.data, '$.text'))
    AND re($c1_pattern, json_extract(p.data, '$.text'))
)
```

This is the model's answer to "must one part satisfy several conditions": a group,
expressed declaratively, without inventing a generic predicate AST.

### Evidence stage

Evidence binds the named constraint:

```sql
substr((
  SELECT json_extract(p.data, '$.text')
  FROM part p
  WHERE p.session_id = s.id
    AND json_extract(p.data, '$.type') = $c0_type
    AND re($c0_pattern, json_extract(p.data, '$.text'))
  ORDER BY p.time_created
  LIMIT 1
), 1, $evidence_len) AS snippet
```

`forConstraint: "c0"` — not positional index 0. The planner reuses `$c0_*`
bindings so evidence and its matching constraint can never drift apart in
parameter order.

### Title lowering

```sql
WHERE re($t1_pattern, s.title)
  AND s.time_updated >= $t2_from
ORDER BY s.time_updated DESC LIMIT $limit
```

One `TextMatch`, two relations: `titleMatch` emits `re($…, s.title)`; content
emits `re($…, textExpr)`. The compiler needs no title-only mode.

### Named bindings

The planner assigns `$<constraintId>_<slot>` names before emitting any SQL, so a
snippet placeholder in `SELECT` and scope placeholders in `WHERE` never create a
positional-order coupling between compiler stages. This removes a real current
fragility: `buildContentQuery`'s parameter list interleaves snippet, patterns,
scopes, and limit by hand (`source.ts:39-44`).

## History and aggregates

History is the same query shape with a closed `counts` projection:

- its **scope** (updatedIn, directoryContains) is ordinary session-row
  constraints, lowered by the same planner;
- its **aggregate expressions** (`count(*)` over `message` vs `session_message`)
  are storage-specific and live with the backend descriptor, exactly as
  `textExpr`/`snippetExpr` already do. The planner wires them into the projection
  stage but never interprets aggregation semantics.

The backend descriptor therefore gains a `counts` fragment pair:

```ts
interface DirectBackend {
  kind: "direct-v1" | "direct-v2";
  relations: { session: true; content: true };
  capabilities: ReadonlySet<"regex" | "phrase">;
  content: {
    from: string;            // "part p" | "event e"
    sessionPredicate: string;
    typeExpr: string;
    textExpr: string;
    snippetExpr: string;
    orderExpr: string;
  };
  counts?: {
    totalExpr: string;       // per-table count expressions
    recentExpr: string;
  };
}
```

Tradeoff, stated plainly: this folds history's count projection into the plan
rather than leaving it a private hand-rolled query. The justification is that
history *already* shares the scope semantics with search (same `--since` /
`--directory` grammar per the README), and the plan's projection stage must be a
small closed union regardless. The cost is that the projection union grows and
the backend descriptor carries one more fragment pair. If history were the only
caller forever, keeping it separate would be leaner; the migration step 7 makes
this an explicit, reversible decision rather than an assumption.

## V1/V2 and future FTS

V1 and V2 stop being query owners. Today `Source.searchContent(q)` executes a
whole query per version (`v1/source.ts:12`); the design inverts this — the
**planner owns queries**, backends own only expression fragments and
capabilities. `detectBackend` returns one descriptor (V1 if `part` exists, else
V2 if `event` exists), so the "query runs against every source and results are
deduplicated by id" loop in `search.ts:58-68` collapses to one execution. Whether
dedup disappears entirely is a flagged decision (see unresolved #8).

FTS is a third backend descriptor with the *same* query surface and a different
`Plan` kind:

- session-row constraints → `WHERE`/`JOIN` on `indexed_session`;
- content constraints → FTS5 `MATCH` expression, one per group;
- evidence → `snippet(parts_fts, …)`;
- order → `bm25` rank when `order.by === "rank"`;
- `TextMatch.kind: "fts"` is the FTS-native match kind, and `regex` is rejected
  by capability probe (below).

The shared durable pieces are therefore: `SessionQuery`, `Selection`, `TextMatch`
union, `SessionResult`, and the plan shape. FTS is a *port of the planner to a
second backend*, not a parallel command.

### Capabilities and unsupported semantics

Each backend declares `capabilities`. `plan` probes before lowering and throws a
typed `UnsupportedMatchError` for kinds a backend cannot express — **rejection,
not silent fallback**:

```ts
export class UnsupportedMatchError extends Error {
  constructor(readonly backend: string, readonly kind: string) {}
}
```

Direct supports `regex` and `phrase` (a phrase lowers to escaped-adjacency regex;
the word-boundary caveat is documented, not hidden). FTS supports `phrase` and
`fts`. Nothing in the model pretends JavaScript regex and tokenized FTS are the
same operation; the CLI surfaces one `search` command and the backend selection
happens behind `querySessions`, so a user on an indexed DB gets FTS semantics
and a user on a bare DB gets regex semantics — visibly, per the README's
two-phase plan.

## Alternatives considered

### The draft: session-centered envelope (`SessionSelection` + `ContentSelection`)

The strongest prior art in this wave. Its `SessionQuery` with a reusable
`SessionSelection`, first-class content requirements, and evidence-as-projection
is sound and much of this design agrees with it (evidence is projection, storage
versions are behind one seam, history shares scope, deferred FTS seam).

Where this design diverges and why:

- **Root.** The draft answers "session"; this design answers "content units,
  sessions as the grouping target". Consequences: FTS is a natural second
  lowering rather than a reason to reconsider the root; same-unit quantification
  (draft question 5) has a natural home; the "first snippet from first pattern"
  accident is re-modeled as evidence bound to a named constraint.
- **One selection vs two.** The draft keeps metadata selection and content
  requirements as separate siblings. This design merges them into one
  relation-tagged `Selection`, making "content participates in session
  selection" (draft question 2) a structural fact rather than a rhetorical one.
- **Named plan.** The draft keeps the compiled artifact an internal
  `{ sql, bindings }`. This design exports `plan` as a named value so pushdown
  and grouping are *tested as structure*, and the FTS phase ports the plan
  rather than re-deriving it. This is the deliberate over-share; see unresolved
  #3 for the risk.
- **Backend seam now, passive.** The draft defers any backend interface. Because
  the README specifies the FTS phase concretely (schema, commands, semantics),
  this design introduces a *passive* backend descriptor now — cheap, since it is
  little more than today's `VersionSchema` plus a capability set.

### Generic criterion list (`{ range, field, operator, value }[]`)

Rejected, as in the draft: it is a mini predicate engine and violates the deep
module. The relation tag here is closed and per-kind, not an open `range`/
`field`/`operator` triple.

### Operation-specific requests sharing only scope

Retained as fallback. If the plan projection union proves premature, history can
keep its own SQL and the shared value shrinks to `Selection` compilation — the
same retreat the draft keeps.

### A query-builder DSL

A fluent `selection().directory(...).content(...)` builder could make invalid
combinations inexpressible (e.g. `role` without `on: "content"`). Rejected for
now: cotail is a CLI with one-line constructions; a builder adds surface without
demand. If role or OR make combinational validity a real problem, revisit.

## Unresolved decisions and experiments

1. **Is the unit-centric root worth the naming cost?** The model reads slightly
   more abstractly than "query sessions". The FTS phase is the real test — if
   FTS lowering of this model is visibly simpler than the draft's, the root is
   vindicated. Prototype both lowers against the README's FTS schema.
2. **`group` semantics on the tool type.** `--type tool` searches raw `p.data`
   but snippets `$.state.input` (`v1/source.ts:23-24`). Does "same unit" for tool
   mean same JSON blob, or same input/output pair? Decide with a fixture before
   promising grouping for `tool`.
3. **Should `plan` be public?** Exposing it is the biggest interface bet. If the
   FTS phase lands and the plan shape needs surgery, callers (only tests and
   `execute`) absorb it. Alternative: keep `plan` internal and test via
   `querySessions` against fixtures, deferring the export until FTS needs it.
   Experiment: write the FTS plan *beside* direct in the prototype before
   committing to export.
4. **Does `--directory` mean contains or exact?** It is `instr(...) > 0` in
   search/history and `= ?` in `get-session`. The shared constraint vocabulary
   forces one answer; the CLI's `parseDirectoryArg` could keep both by selecting
   the constraint kind, but the divergence should be made deliberate.
5. **History in the plan, or separate?** The counts projection is this design's
   most forward-leaning choice. Flagged for reversal (migration step 7) if the
   projection union feels heavy.
6. **Role.** Declared on content constraints, unimplemented. Where role lives in
   V1 (`message` row joined by part) and V2 (event `part.message.role`?) must be
   researched before the field is honored.
7. **Dedup.** With one backend chosen by detection, the `seen`-set loop should
   be removable. Confirm no DB in practice has both `part` and `event`.
8. **Evidence under FTS.** `firstBy: "created"` vs `"rank"` — rank-aware
   snippets change the evidence vocabulary (`Evidence` and `Order` both gain a
   rank option). Decide when indexing lands; the union is closed and additive.

## Incremental implementation sequence

Each step compiles and the CLI keeps working. Commits are ordered so behavior is
observable at every point.

1. **Characterize current behavior with fixtures.** In-memory V1/V2 SQLite
   fixtures; tests for title, multi-pattern content, snippet-from-first-pattern,
   scope clauses, history counts. Lock in today's semantics before moving them.
2. **Introduce `Selection` and `Constraint` types** with relation tags and
   constraint ids. Construct current query values from the existing CLI args;
   no SQL change yet.
3. **Move scope compilation into a `plan` step.** Extract updated/directory SQL
   into the planner's scope stage; have search, history, and title share it. This
   is the first real dedup of the four SQL builders.
4. **Move content matching into the planner's match stage.** Replace raw
   `patterns`/`typeFilter` with named content constraints; emit one EXISTS per
   constraint. Snippet binds `patterns[0]` → `forConstraint: firstId`.
5. **Switch to named bindings.** Planner assigns `$<id>_<slot>` before emitting
   SQL; removes positional interleaving.
6. **Extract `querySessions` + `execute`.** Collapse the per-source loop in
   `search.ts` behind one call; decide dedup removal (unresolved #7).
7. **History as `counts` projection.** Fold `countActiveSessions` into the plan;
   keep the reversal point documented (unresolved #5) — revert to a private
   history query if the union feels wrong.
8. **`sessionId` / `projectId` constraints** — exercise indexed scope.
9. **`beforeExclusive` updated range** with boundary tests.
10. **`group` same-unit matching** — implement `group` in the match stage with
    one-EXISTS lowering; add fixtures for "different units" vs "same unit".
11. **`phrase` match kind** on the direct backend (escaped adjacency), with the
    word-boundary caveat documented.
12. **Normalize results** — epoch-ms timestamps, renderers format at the edge.
13. **`requireAny` (OR)** — only with defined interactions with `group` and
    tests; keep it out of the base vocabulary until then.
14. **Port planner to FTS** when indexing begins — plan shape is the checklist.

## How later features fit

- **`--project`** — one new session-row constraint kind:
  `{ id, on: "session", kind: "projectId", value }`. All commands inherit it via
  `Selection`; the scope stage emits `s.project_id = $…`. No parallel edits.
- **Date range** — `updatedIn` already holds `{ fromInclusive, beforeExclusive }`;
  CLI `--since` fills `fromInclusive` and a future `--until` fills
  `beforeExclusive`. Half-open, boundary-tested.
- **Role** — a field on content constraints, lowered to a `message`/role join by
  the V1/V2 descriptors once provenance is known. Declared now, honored later.
- **OR** — `requireAny` in `Selection`, lowered to OR'd EXISTS clauses. Defined
  interaction with `group` required; not in the initial vocabulary.
- **Phrase** — a `TextMatch` kind. Direct: escaped adjacency regex (semantics
  preserved for literal phrases, caveat on tokenization). FTS: native phrase
  syntax. One concept, two lowers, capabilities reject what a backend can't do.

## Recommendation

Build toward the match-first model, but land it the same incremental way the
draft does: characterize behavior first, then let the `Selection` vocabulary and
the named `plan` emerge behind `querySessions`. The strongest reasons to prefer
this alternative over the draft are the same-unit `group` (which turns the
current AND-across-parts accident into an explicit, testable choice) and the
plan-as-port-unit for the concretely planned FTS phase. If the FTS prototype
shows the unit-centric framing earns its abstraction, commit to it; if not, the
design degrades gracefully to the draft's session envelope with only the
`Selection`-and-`plan` scaffolding to discard.

The desired depth, restated: **a caller states which sessions qualify, which
content must exist and how it is grouped, and what evidence to return — in one
relation-tagged selection — and the module lowers it to any backend via a named,
testable plan.**
