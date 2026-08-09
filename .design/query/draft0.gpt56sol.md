---
type: Design
title: Typed session-query architecture
description: Draft architecture making session and content criteria first-class while compiling them into direct SQLite queries and, later, FTS queries.
resource: /query/draft0.gpt56sol.md
tags: [cotail, query, search, architecture, sqlite, fts]
status: draft
generated: { by: model:openai/gpt-5.6-sol, at: 2026-08-09T23:57:39Z }
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
  - id: project-readme
    resource: /README.md
    title: Cotail behavior and planned FTS architecture
---

# Typed Session-Query Architecture

## Status

This is a first draft. It proposes a direction and vocabulary, but intentionally leaves matching semantics and the eventual direct/FTS seam open to validation.

## Thesis

Cotail's root query object is a **session**. Metadata criteria select sessions directly; content criteria select sessions through facts about related content. Search results may also project evidence explaining which content satisfied the query.

The architecture should make all three first-class:

1. **selection**: which sessions qualify from session metadata;
2. **requirements**: what must exist in related content; and
3. **projection**: what session data and matching evidence to return.

The public module should accept a typed session query and return normalized session results. It should hide direct-database versions, correlated subqueries, placeholder binding, source detection, deduplication, snippet extraction, and eventually backend-specific query compilation.

This is a typed domain query, not a generic SQL predicate language.

## Vocabulary

### Session selection

`SessionSelection` contains criteria evaluated directly against session metadata. The name describes its job: winnowing the sessions considered by the rest of the query.

Likely fields include:

- session ID;
- project ID;
- directory contains;
- updated-time range;
- title requirements, if title is treated as ordinary session metadata.

### Content requirement

A `ContentRequirement` states that qualifying related content must exist. It declares what it ranges over, such as text parts, reasoning parts, or tool parts.

Content requirements are not session metadata. They compile to correlated existence checks in direct search and to index constraints in an FTS implementation.

### Content selection

`ContentSelection` combines content requirements using explicit quantification. The initial form needs only the current behavior: every requirement must have at least one matching content item, but each requirement may be satisfied by a different item.

### Projection

`SessionProjection` states what to return. Summary fields, raw timestamps, snippets, and later match evidence belong here rather than inside filtering criteria.

### Evidence

Evidence is related data returned to explain or present why a session matched. The current snippet is evidence selected from a content requirement. Evidence has its own source requirement, ordering, and size policy.

### Query compiler

A query compiler lowers the typed query into a storage-specific execution plan. Predicate pushdown belongs here.

### Execution plan

For direct SQLite, an execution plan may be no more than SQL plus named bindings and row normalization. It should initially remain an internal implementation detail rather than becoming another public abstraction.

## Proposed Query Model

The following types illustrate semantics. Exact names and syntax can change.

```ts
export interface SessionQuery {
  session: SessionSelection;
  content?: ContentSelection;
  projection: SessionProjection;
  order: SessionOrder;
  limit: number;
}

export interface SessionSelection {
  id?: string;
  projectId?: string;
  directoryContains?: string;
  title?: TextRequirements;
  updated?: TimeRange;
}

export interface TimeRange {
  fromInclusive?: number;
  beforeExclusive?: number;
}

export interface ContentSelection {
  requireEvery: readonly ContentRequirement[];
}

export interface ContentRequirement {
  contentType: "text" | "reasoning" | "tool";
  text: TextRequirement;
  role?: "user" | "assistant";
}

export interface TextRequirements {
  requireEvery: readonly TextRequirement[];
}

export interface TextRequirement {
  kind: "regex";
  pattern: string;
  caseSensitive: boolean;
}

export interface SessionProjection {
  fields: "summary";
  evidence?: ContentEvidence;
}

export interface ContentEvidence {
  kind: "snippet";
  requirement: number;
  firstBy: "created";
  maxCharacters: number;
}

export interface SessionOrder {
  by: "updated";
  direction: "descending" | "ascending";
}
```

Several choices are intentionally narrow:

- no generic field reference;
- no generic `and`/`or` expression tree;
- no arbitrary projection list;
- no backend name in the query;
- no FTS expression pretending to be a regex;
- no role support until V1/V2 provenance and desired behavior are verified.

The role field above illustrates placement, not an implementation commitment.

## Why Content Is First-Class

The previous conceptual split treated session metadata as a reusable selection and content as a singular `ContentMatch`. That does not capture current semantics well enough.

For:

```sh
cotail search opencode journal
```

the current implementation means:

```text
there exists content matching /opencode/i
and
there exists content matching /journal/i
```

The two patterns may match different parts. This is different from requiring one part to match both patterns.

The proposed value makes this explicit:

```ts
const query: SessionQuery = {
  session: {},
  content: {
    requireEvery: [
      {
        contentType: "text",
        text: { kind: "regex", pattern: "opencode", caseSensitive: false },
      },
      {
        contentType: "text",
        text: { kind: "regex", pattern: "journal", caseSensitive: false },
      },
    ],
  },
  projection: {
    fields: "summary",
    evidence: {
      kind: "snippet",
      requirement: 0,
      firstBy: "created",
      maxCharacters: 200,
    },
  },
  order: { by: "updated", direction: "descending" },
  limit: 50,
};
```

The query now states both qualification and evidence policy. SQL no longer defines those semantics accidentally.

## Title Search

Title ranges over the session row, so this draft places it in `SessionSelection`:

```ts
const query: SessionQuery = {
  session: {
    directoryContains: "/home/rektide/src/compfuzor",
    updated: { fromInclusive: cutoff },
    title: {
      requireEvery: [
        { kind: "regex", pattern: "merge", caseSensitive: false },
      ],
    },
  },
  projection: { fields: "summary" },
  order: { by: "updated", direction: "descending" },
  limit: 50,
};
```

This removes title search as an independent SQL path. It also permits a future query requiring both a title condition and content evidence without inventing another mode.

A plausible alternative is a closed `SearchTarget` union with title and content variants. That interface is smaller, but it preserves the current mutually exclusive mode and makes combined criteria harder. This draft favors relation-specific criteria over target modes.

## Direct Compiler

The command should not assemble SQL. Its role is:

1. parse CLI arguments;
2. construct a `SessionQuery`;
3. call the query module; and
4. render normalized results.

The external seam should be one deep function:

```ts
export function querySessions(
  db: DatabaseSync,
  query: SessionQuery,
): SessionResult[];
```

Internally, the direct implementation can use several private compilation steps:

```text
normalize query
    |
    +-> compile session selection
    +-> compile content requirements through V1/V2 projection
    +-> compile evidence projection
    +-> compile ordering and limit
    |
assemble direct SQLite plan
    |
execute and normalize rows
```

### Named bindings

The compiler should use named SQLite bindings. They remove positional ordering as an interface invariant, particularly where a snippet placeholder in `SELECT` appears before content and selection placeholders in `WHERE`.

An internal result might be:

```ts
interface DirectPlan {
  sql: string;
  bindings: Record<string, string | number | null>;
}
```

This type does not need to escape the direct-query implementation.

### Session selection lowering

```ts
session: {
  projectId: "project-123",
  directoryContains: "/src/compfuzor",
  updated: {
    fromInclusive: 1_786_000_000_000,
    beforeExclusive: 1_787_000_000_000,
  },
}
```

lowers approximately to:

```sql
s.project_id = $project
AND instr(s.directory, $directory) > 0
AND s.time_updated >= $updatedFrom
AND s.time_updated < $updatedBefore
```

Project and session-ID criteria can use existing source indexes. Updated and directory criteria still scan session rows in the current source database, but they prevent expensive content evaluation for rejected sessions. Cotail should not modify opencode's database to add indexes.

### Content lowering

Each member of `content.requireEvery` lowers to a separate `EXISTS` clause:

```sql
EXISTS (
  SELECT 1
  FROM part p
  WHERE p.session_id = s.id
    AND json_extract(p.data, '$.type') = $contentType0
    AND re($pattern0, json_extract(p.data, '$.text'))
)
AND EXISTS (
  SELECT 1
  FROM part p
  WHERE p.session_id = s.id
    AND json_extract(p.data, '$.type') = $contentType1
    AND re($pattern1, json_extract(p.data, '$.text'))
)
```

V2 compiles the same content requirements through its event projection. The query model does not expose the table or JSON paths.

### Evidence lowering

The snippet projection lowers to a correlated subquery using the chosen requirement:

```sql
substr((
  SELECT json_extract(p.data, '$.text')
  FROM part p
  WHERE p.session_id = s.id
    AND json_extract(p.data, '$.type') = $evidenceType
    AND re($evidencePattern, json_extract(p.data, '$.text'))
  ORDER BY p.time_created
  LIMIT 1
), 1, $snippetLength)
```

The compiler may reuse named bindings from the requirement. The evidence contract makes the current first-pattern behavior visible and testable.

## V1 And V2

V1 and V2 are storage projections within direct search, not separate search backends.

The existing classes execute identical logic and differ mainly in table and expression fragments. A private projection descriptor may eventually be deeper and simpler:

```ts
interface DirectContentProjection {
  from: string;
  sessionPredicate: string;
  typeExpression: string;
  textExpression: string;
  evidenceExpression: string;
  createdExpression: string;
}
```

The direct compiler receives the detected projection and lowers one `SessionQuery` through it.

This refactor should occur only after query behavior is covered by tests. Replacing classes is optional; the important design change is keeping version details behind `querySessions`.

## FTS

FTS should not become another current `Source`. It is a different backend with different matching semantics:

- FTS uses tokenized `MATCH`, not JavaScript regex;
- it introduces ranking;
- it generates FTS-native snippets;
- it queries cotail's owned index and metadata schema;
- it can own useful indexes for project and updated-time selection;
- its available content metadata depends on what indexing projects.

The durable shared pieces are likely:

- `SessionSelection`;
- normalized session identity and timestamps;
- projection intent at a conceptual level;
- possibly a broader query envelope.

The text requirement may need a closed union once FTS exists:

```ts
type TextRequirement =
  | { kind: "regex"; pattern: string; caseSensitive: boolean }
  | { kind: "full-text"; expression: string };
```

The direct compiler can reject `full-text`; the FTS compiler can reject `regex`, unless a product decision introduces fallback. This is preferable to silently changing semantics.

Do not introduce a `SearchBackend` interface until the FTS adapter exists. One adapter means a hypothetical seam. The query model can be designed now without prematurely fixing backend selection.

## History And Aggregates

History demonstrates both the value and the limit of sharing.

It should reuse `SessionSelection` and its direct compiler semantics for updated time and directory. Its message-count expressions are a history-specific aggregate projection and need not be forced into the initial `SessionProjection` vocabulary.

Two reasonable implementation stages are:

1. share only `SessionSelection` compilation between search and history; or
2. later add a closed history projection if another caller needs the same aggregates.

This avoids building arbitrary aggregate support merely to claim one universal query system.

The full `SessionQuery` is therefore initially the interface of the search module. `SessionSelection` is the smaller reusable domain value used by search, history, index selection, and potentially other commands.

## Results

The query module should return storage-neutral data:

```ts
export interface SessionResult {
  id: string;
  slug: string;
  title: string;
  directory: string;
  timeCreated: number;
  timeUpdated: number;
  evidence?: {
    snippet?: string;
  };
}
```

SQLite should not format timestamps. Human, JSON, and TSV renderers should format at the command edge. This also gives direct and FTS implementations the same temporal representation.

## Module Layout

A plausible domain-grouped layout is:

```text
src/
  query/
    session-query.ts       domain values and normalized results
    direct/
      query-sessions.ts    deep direct-query implementation
      compiler.ts          private plan compilation
      projection.ts        V1/V2 content projections
  commands/
    search.ts              parse, call, render
    history.ts             parse, call history query, render
  opencode/
    db.ts                  source DB discovery and opening
    session.ts             history aggregates, using SessionSelection
```

An alternative keeps all direct implementation under `src/opencode/query/`. The important grouping is domain plus backend, not the exact directory spelling.

## Alternatives

### A generic criterion list

```ts
criteria: [
  { range: "session", field: "project", operator: "equals", value: "..." },
  { range: "content", operator: "exists", where: { ... } },
]
```

This makes range explicit and is extensible, but it exposes compiler vocabulary to callers and tends toward a generic predicate AST. It creates a large interface before cotail needs arbitrary expressions.

Rejected for now.

### Operation-specific requests sharing only SessionSelection

```ts
searchDirect(db, SearchRequest)
history(db, HistoryRequest)
index(db, IndexSelection)
```

This is conservative and may be sufficient. Its weakness is that content matching can remain an opaque bag of search flags, preserving the original asymmetry.

Retained as a fallback if the proposed `SessionQuery` proves too broad.

### Structured typed query, recommended

The proposed `SessionQuery` provides named relation-specific criteria and explicit evidence without exposing arbitrary boolean algebra. It makes current semantics programmable while keeping the interface bounded.

Recommended for prototyping and characterization tests.

## Unresolved Decisions

1. Should title requirements live in `SessionSelection`, or should title/content be a closed search-target union?
2. Is `requireEvery` sufficient for the next expected features, or is OR already important enough to model?
3. Should regex flags belong on every requirement or on a shared text-matching policy?
4. Is snippet evidence always tied to one requirement, or should it summarize all requirements?
5. Should snippets retain first-created behavior or choose the most relevant/recent content?
6. Does `--type tool` search raw tool JSON while projecting tool input, and how should that distinction appear in the model?
7. Where is role reliably available in V1 and V2, and what should role constrain?
8. Should direct regex and FTS be separate user-visible commands/modes or selected behind one command?
9. Does deduplication remain necessary once source detection chooses exactly one direct projection?
10. Which session projections are truly shared by search and future indexing?

These decisions should be answered with behavior tests and small prototypes rather than type speculation alone.

## Testing Strategy

The module interface should be the primary test surface:

```ts
querySessions(dbFixture, query)
```

Use small in-memory V1 and V2 SQLite fixtures to cover:

- session-only selection;
- exact updated-time boundaries;
- directory, project, and session-ID selection;
- one content requirement;
- several requirements matching the same part;
- several requirements matching different parts;
- a missing requirement excluding a session;
- title requirements;
- evidence selection and ordering;
- snippets disabled;
- V1/V2 parity;
- named binding reuse;
- normalized timestamps and results.

Test outcomes rather than exact SQL strings. Query-plan inspection and live timing belong in diagnostics or benchmarks, not brittle unit assertions.

## Incremental Migration

Each step should leave the CLI working and form a coherent commit.

1. **Characterize current direct behavior.** Add in-memory V1/V2 and title tests, including multi-part AND and snippet semantics.
2. **Introduce `SessionSelection`.** Map current directory and inclusive updated cutoff into the value without changing SQL structure.
3. **Introduce first-class content requirements.** Replace raw `patterns` and `typeFilter` with explicit independently existential requirements.
4. **Use named SQLite bindings.** Remove positional parameter ordering from direct content and title queries.
5. **Compile session selection once.** Use the compiler from direct search and history while retaining their separate complete queries.
6. **Model evidence explicitly.** Move `showSnippet` and first-pattern behavior into projection/evidence intent.
7. **Extract `querySessions`.** Move title/content compilation, source projection, execution, and deduplication behind one deep interface.
8. **Normalize result timestamps.** Return epoch milliseconds and preserve CLI output through renderers.
9. **Add project and session-ID selection.** Exercise the new selection model with indexed source predicates.
10. **Add a bounded updated range.** Introduce `beforeExclusive` with boundary tests.
11. **Reassess V1/V2 adapters.** Simplify to projection descriptors if the tests demonstrate that the classes add no useful depth.
12. **Design FTS matching when indexing begins.** Decide user-visible semantics before adding a second backend adapter.

## Features After The Migration

### Project

```ts
session: { projectId: "project-123" }
```

One compiler mapping adds `s.project_id = $project`; title, content, and session-only queries inherit it.

### Date range

```ts
session: {
  updated: {
    fromInclusive: start,
    beforeExclusive: end,
  },
}
```

The half-open range composes without boundary overlap.

### Role

```ts
content: {
  requireEvery: [{
    contentType: "text",
    text: pattern,
    role: "user",
  }],
}
```

This fits structurally, but implementation waits for V1/V2 data-model research and FTS indexing requirements.

### OR

Do not add a generic boolean tree immediately. A bounded extension could be:

```ts
interface ContentSelection {
  requireEvery?: readonly ContentRequirement[];
  requireAny?: readonly ContentRequirement[];
}
```

Only add it with defined interactions and tests. If nested boolean expressions become a demonstrated need, revisit the criterion model then.

### Phrase

Phrase meaning depends on the matcher:

- direct regex can express literal adjacency;
- FTS phrase queries depend on tokenization.

Represent phrase as a matcher-specific `TextRequirement`, not as a universal promise unless equivalent behavior is intentionally defined.

## Recommendation

Prototype the structured typed query after first adding characterization tests. Treat `SessionSelection` as the reusable metadata value, content requirements as first-class existential criteria, and snippets as evidence projection. Put compilation and execution behind `querySessions`.

Keep the compiled SQL fragment private. Keep history aggregates operation-specific. Defer a backend seam, generic boolean algebra, role, and regex/FTS unification until real requirements provide a second adapter or demonstrate the need.

The desired depth is:

> A caller states which sessions qualify, which related content must exist, and what evidence to return. The module handles storage versions, pushdown, SQL construction, execution, and normalization.
