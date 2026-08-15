---
type: Design
title: Session qualification and witness model
description: Adjudicates the object model for selecting sessions through metadata, title, and related-content witnesses without pretending direct regex and FTS share one language.
resource: /query/design2.md
tags: [cotail, query, selector, qualification, witness, evidence, object-model]
status: draft
generated: { by: agent:opencode-query-object-model, at: 2026-08-15T00:00:00Z }
stale_after: 2026-11-15
sources:
  - id: original-problem
    resource: /query/prompt0.gpt56sol.md
    title: Original query architecture problem and questions
  - id: prior-cross-assessment
    resource: /query/draft1.syn.md
    title: Cross-assessment of the first query-model wave
  - id: operation-refinement
    resource: /query/draft1.gpt56sol.md
    title: Operation-shaped query refinement
  - id: relation-tagged-alternative
    resource: /query/design-alt0.ds4f.md
    title: Relation-tagged selection and named-plan alternative
  - id: selection-spine-alternative
    resource: /query/design-alt0.glm52.md
    title: Selection-spine and backend-owned-match alternative
  - id: current-domain
    resource: /packages/query-domain/src/index.ts
    title: Current query-domain contracts and validation
  - id: current-lowering
    resource: /packages/opencode-live-store/src/query/content.ts
    title: Current direct content qualification and evidence lowering
  - id: storage-authority
    resource: /query/authority0.md
    title: Constraints imposed by canonical V1 and V2 storage authority
  - id: builder-evaluation-packet
    resource: /query/packet-query-builders0.md
    title: Non-negotiable witness and bounded-boolean semantics
---

# Session Qualification And Witness Model

## The Actual Problem

The unresolved design object is **how a caller says which sessions qualify**.
The hard part is not a query builder, FTS rollout, package graph, or migration
sequence. It is an object model that distinguishes criteria over a session row
from criteria over related content, and that states whether several conditions
must share one witness or may be satisfied by different witnesses.

This document adjudicates that object model. It asks what `SessionSelector`,
title matching, content requirements, witness scope, exclusion, evidence,
aggregates, ordering, and backend match languages should mean and how they fit.
Storage authority in [`authority0.md`](/query/authority0.md) constrains which rows
may serve as witnesses, but it does not organize this design.

## We Are Not Restarting

[`draft1.syn.md`](/query/draft1.syn.md) already cross-assessed the initial
`SessionQuery` envelope and three independent alternatives. It reached strong
consensus on the following points:

- A session is the identity, result, limit, and deduplication root for current
  operations. Content units are related witnesses, not top-level results.
- Metadata criteria and existential content criteria have different ranges and
  quantification. The model must not flatten that distinction accidentally.
- A reusable session metadata value is worthwhile across search, history, and
  resolution.
- One content requirement is witnessed by one content unit. Separate
  requirements may use different units. This boundary must be structural.
- Evidence is projection from a qualifying witness, never an additional filter.
- History counts are operation-specific aggregates, not session fields.
- Direct regex and FTS-native matching are different languages. Unsupported
  semantics must be rejected rather than silently translated.
- Physical V1/V2 relations, SQL, bindings, and plans remain private.
- A recursive generic predicate AST and a public execution plan were premature.

The synthesis provisionally selected operation-shaped requests with a narrow
`SessionSelector` and nested `PatternSet` / `ContentRequirements` values. It
preferred that model over one universal envelope and over a relation-tagged flat
constraint list.

That conclusion was **provisional in three object-model details**:

1. It moved title out of the shared selector, but did not settle how title and
   content could be required together. The strongest refinement explicitly
   deferred that conjunction.
2. It retained positional evidence (`requirement: 0`), despite the
   relation-tagged alternative having identified stable names as the better
   provenance mechanism.
3. It alternated between typing `any`/`none` immediately and deferring them,
   without clearly distinguishing a semantic model from initial CLI exposure.

The current implementation subsequently proved the bounded two-level boolean
model executable. It also made title and content sibling optional fields but,
as deliberately limited by the initial implementation adjudication, validates
them as mutually exclusive. This document recovers the prior work, removes that
initial-scope restriction from the target model, and narrows what remains open.

## Core Vocabulary

| Term | Meaning |
|---|---|
| **session / result root** | The entity returned, ordered, limited, and deduplicated by current search, history, and resolution operations. |
| **selector** | Reusable conjunctive criteria over session identity and non-text metadata: ID, project, directory, and time ranges. |
| **qualification** | The complete truth condition deciding whether a session belongs in a particular operation's result. For direct search this is selector AND optional title condition AND optional content condition. |
| **metadata selector** | Synonym for `SessionSelector`; deliberately narrower than all qualification. |
| **content requirement** | Conditions that one related content unit must satisfy together. |
| **pattern** | A matcher-language value applied to one string. Direct patterns are regex or escaped literal; FTS queries are different types. |
| **witness** | One canonical related content unit satisfying one content requirement. |
| **witness scope** | The boundary within which predicates must hold on the same value or unit. Pattern groups are inside one value; requirement groups quantify over units. |
| **evidence** | Returned provenance or excerpt from a positive witness that participated in qualification. It does not change truth. |
| **projection** | The operation-specific result shape, including evidence or counts. |
| **aggregate** | A value computed over related rows, such as message count. It is not ordinary metadata and does not qualify a session unless a future operation explicitly says so. |
| **order / window** | Ordering followed by limit or cursor rules over qualifying result roots. These are operation-specific because direct recency, FTS rank, search zero-limit, and history zero-limit need not agree. |
| **backend match language** | The exact language interpreted by a backend: JavaScript-style regex/literal for direct search, or FTS terms/phrase/expression for an index. |

### Retire Bare “Scope”

Retire **scope** as a standalone domain object or loose synonym for filtering.
It has been used for metadata filtering, CLI narrowing, witness grouping, and
backend pushdown, which makes statements such as “scope the query” ambiguous.
Use these precise terms instead:

- `SessionSelector` for reusable metadata eligibility;
- **qualification** for the complete membership predicate;
- **witness scope** only for same-value/same-unit quantification; and
- **window** for order/limit/cursor behavior.

The phrase “selector/scope model” may remain historical shorthand, but no public
type should be named `Scope`.

## Requirements From Queries

The object model must make each query's truth conditions visible.

| Query | Required semantics |
|---|---|
| Directory + updated session filtering | One session has a directory satisfying an explicit mode and `from <= updated < to`. Both are metadata predicates and compose by AND. |
| Exact ID/project selection | Session ID belongs to a non-empty set AND project ID belongs to a non-empty set. Values within each set compose by OR. |
| Title matching | A pattern group is evaluated against the one session title value. It needs no content witness. |
| Two content terms on different units | Two content requirements in outer `all`; each may choose its own witness. |
| Two patterns on the same unit | One content requirement whose inner `PatternSet.all` contains both patterns. |
| Pattern-level OR/exclusion | On one title/content text value, `any` means one listed pattern matches; `none` means no listed pattern matches. |
| Requirement-level OR/exclusion | `any` means at least one requirement has a witness; `none` means no listed requirement has any witness. |
| Role/type on the same witness | `types`, `roles`, and `text` are fields of one content requirement and therefore constrain one unit together. |
| Title + content conjunction | The same session satisfies the title condition AND the content requirements. This must not require a recursive AST. |
| History versus message cutoff | `selector.updated.from` chooses sessions; `countSince` chooses messages included in an aggregate. Equal timestamps supplied by one CLI flag remain distinct semantic positions. |
| Evidence from qualification | Evidence names a positive requirement that actually had a witness. Negative requirements can never source evidence. |
| Direct regex versus FTS | Requests carry different matcher types. Shared naming must not imply equivalent tokenization, phrase, ranking, or witness behavior. |

Two negations are intentionally different. A positive content requirement with
`text.none: [secret]` asks for **some unit** satisfying its type/role conditions
whose text does not match `secret`. Putting a requirement for `secret` in outer
`requirements.none` asks for **no such unit anywhere in the session**. The
object nesting makes this difference reviewable.

## Candidate Object Models

### A. Operation-Shaped Requests With A Narrow Selector

This candidate embeds reusable metadata selection in operations, then gives
search its own bounded qualification model.

```ts
interface SessionSelector {
  ids?: readonly string[];
  projectIds?: readonly string[];
  directory?: { mode: "exact" | "contains"; value: string };
  updated?: { from?: number; to?: number };
}

interface DirectSearchRequest {
  selector: SessionSelector;
  qualification: {
    title?: PatternSet;
    content?: ContentRequirements;
  };
  evidence: DirectEvidenceRequest;
  order: "updated-desc";
  limit: number;
}
```

Worked value:

```ts
const query: DirectSearchRequest = {
  selector: {
    directory: { mode: "contains", value: "/src/cotail" },
    updated: { from: cutoff },
  },
  qualification: {
    title: { all: [{ kind: "literal", value: "query" }] },
    content: {
      all: [
        { id: "objective", types: ["text"], text: { all: [{ kind: "regex", source: "object model" }] } },
        { id: "witness", types: ["text"], text: { all: [{ kind: "regex", source: "same unit" }] } },
      ],
    },
  },
  evidence: { kind: "first-positive-content-witness", maxCharacters: 200 },
  order: "updated-desc",
  limit: 50,
};
```

The GLM selection-spine design is important prior art within A, not a fourth
candidate. It supplied the argument that metadata selection is the shared spine,
projection is separate, and match languages belong to their backend. This
version differs by making content requirements a domain value rather than an
opaque backend bag and by allowing title plus content in one direct operation.

### B. Relation-Tagged Selection With Named Constraints

This candidate represents all qualification as one list whose members state the
relation they range over. Same-unit requirements use grouping or named
constraints.

```ts
interface Selection {
  all: readonly Constraint[];
}

type Constraint =
  | { id: string; on: "session"; kind: "project"; value: string }
  | { id: string; on: "session"; kind: "updated"; range: TimeRange }
  | { id: string; on: "session"; kind: "title"; match: DirectPattern }
  | {
      id: string;
      on: "content";
      witnessGroup?: string;
      types: readonly ContentType[];
      roles?: readonly ContentRole[];
      match: DirectPattern;
    };
```

Worked value:

```ts
const selection: Selection = {
  all: [
    { id: "project", on: "session", kind: "project", value: "cotail" },
    { id: "title", on: "session", kind: "title", match: regex("query") },
    { id: "term-a", on: "content", witnessGroup: "one-unit", types: ["text"], match: regex("scope") },
    { id: "term-b", on: "content", witnessGroup: "one-unit", types: ["text"], match: regex("selector") },
  ],
};
```

This model makes relation and named evidence references explicit and can evolve
toward a planner. Its cost is that a flat tagged list erases useful nesting:
`types`, `roles`, and text patterns naturally describe one witness, while a
caller-managed `witnessGroup` reconstructs that boundary indirectly. Boolean
composition also becomes awkward unless the list grows grouping rules or a
recursive tree.

### C. Universal `SessionQuery` Envelope

This candidate gives selection, content qualification, projection, ordering,
and window sibling positions in one session-rooted query.

```ts
interface SessionQuery {
  session: SessionSelection;
  content?: ContentSelection;
  projection: SessionProjection;
  order: SessionOrder;
  window: SessionWindow;
}
```

Worked value:

```ts
const query: SessionQuery = {
  session: {
    projectIds: ["cotail"],
    title: { all: [regex("query")] },
  },
  content: {
    all: [
      { id: "a", types: ["text"], text: { all: [regex("scope")] } },
      { id: "b", types: ["text"], text: { all: [regex("selector")] } },
    ],
  },
  projection: { kind: "summary-with-evidence", fromRequirement: "a" },
  order: { by: "updated", direction: "desc" },
  window: { limit: 50 },
};
```

This is coherent for session search and gave the first wave its clearest
selection/requirements/projection vocabulary. It becomes less coherent when
history counts, resolution cardinality, direct evidence, FTS ranking, and
operation-specific zero-limit behavior are forced into the same unions. The
envelope either admits invalid combinations or accumulates conditional generic
parameters that recreate operation-shaped requests less legibly.

## Adjudication Matrix

Scores are relative: **strong**, **mixed**, or **weak** for cotail's present
domain, not universal judgments about query design.

| Criterion | A. Operation-shaped | B. Relation-tagged | C. Universal envelope |
|---|---|---|---|
| Conceptual fit | **Strong**: mirrors session operations and related witnesses. | Mixed: relation calculus is accurate but more abstract than callers need. | Mixed: excellent for search, stretched for history/resolution. |
| Witness clarity | **Strong**: requirement nesting is the witness boundary. | Mixed: requires group identifiers or grouped constraint nodes. | **Strong** if it adopts the same nested requirements. |
| Invalid states | **Strong**: direct, indexed, history, and resolve requests are distinct. | Weak: one list needs capability and projection validation after construction. | Weak/mixed: projection/order/backend combinations need conditional validation. |
| Extension pressure | **Strong** until cross-relation boolean logic appears. | Mixed: new leaf kinds are easy; grouping semantics accumulate. | Mixed: sibling axes are easy, union cross-products grow. |
| Title placement | **Strong** as search qualification beside content. | Strong mechanically; semantically title looks interchangeable with content. | Mixed: title in session selection risks coupling reusable metadata to matcher language. |
| Cross-relation composition | Supports title AND content directly; intentionally not OR. | **Strongest** route toward arbitrary composition. | Supports sibling AND; OR still needs an AST. |
| Evidence references | **Strong** with stable requirement IDs and positive-source policy. | **Strong** because constraints are already named. | Strong if requirements are named; earlier version used indexes. |
| Aggregates | **Strong**: remain in `HistoryRequest`. | Weak/mixed: projection union or separate operation still required. | Mixed: a projection union invites generic aggregate machinery. |
| Backend honesty | **Strong**: distinct direct and indexed request languages. | Weak/mixed: a shared text constraint union invites unsupported combinations. | Mixed: can use distinct variants, but the universal envelope suggests more parity than exists. |
| CLI construction | **Strong**: commands build bounded nested values. | Mixed: IDs/groups and relation tags are ceremony. | Strong for simple search; mixed across operations. |
| Lowering | **Strong**: selector predicates plus one `EXISTS` per requirement. | Strong but requires partition/group pass. | Strong for search; branching projection compiler for other operations. |
| Testability | **Strong** through operation fixtures and pure validation. | Strong, especially if plan structure is exposed; that exposure is unnecessary. | Strong for search, larger combinatorial matrix overall. |
| API depth | **Strong**: small values in, domain products out; storage hidden. | Mixed: caller sees planner-oriented relation vocabulary. | Mixed: broad surface exposes axes irrelevant to each caller. |
| Migration from current | **Strongest**: current production is already close. | Weak: reshapes all current requests and lowering. | Mixed: current operation APIs would be wrapped or replaced. |

## Verdict

Adopt **A: operation-shaped requests with a narrow metadata selector and bounded
search qualification**.

This reassesses rather than repeats [`draft1.syn.md`](/query/draft1.syn.md):

| Prior conclusion | Decision here |
|---|---|
| Session is the current result root. | **Accepted.** Future message/content-returning operations get their own roots and requests. |
| Operation-shaped requests share `SessionSelector`. | **Accepted.** This remains the smallest coherent common object. |
| Nested pattern and content requirement groups define witness semantics. | **Accepted.** Current implementation has validated the model. |
| Title is outside the reusable selector. | **Accepted, sharpened.** Title belongs in direct search qualification beside content, not in metadata selection and not as a mutually exclusive search mode. |
| Title and content composition can wait. | **Rejected.** Simple conjunction is already required and fits without new abstraction. |
| Evidence may identify requirement zero. | **Modified.** Requirements receive stable IDs; evidence returns the ID of the positive witness source. No positional magic. |
| Type `any` and `none` only later. | **Modified.** They belong in the semantic model now because their two scopes are settled and implemented; CLI syntax may remain deferred. |
| Direct and FTS use distinct requests. | **Accepted.** They share selectors and session identity, not text syntax or evidence mechanics. |
| No public planner or recursive AST. | **Accepted.** The threshold for revisiting an AST is stated below. |
| History and resolution share the full search query model. | **Rejected.** They share only metadata selection and session products. |

This is a small hybrid only in the literal sense that it retains the strongest
idea from B: **stable names for evidence provenance**. It does not adopt B's
relation-tagged list or exported plan. The resulting model has one organizing
rule: operation requests own complete qualification; `SessionSelector` is the
reusable metadata subset; nested requirements own witness boundaries.

## Recommended Model

### Exact Semantic Types

```ts
export interface SessionSelector {
  ids?: readonly string[];
  projectIds?: readonly string[];
  directory?: DirectorySelector;
  updated?: TimeRange;
}

export interface DirectorySelector {
  mode: "exact" | "contains";
  value: string;
}

export interface TimeRange {
  from?: number; // inclusive epoch milliseconds
  to?: number;   // exclusive epoch milliseconds
}

export type ContentType = "text" | "reasoning" | "tool" | "shell";
export type ContentRole = "user" | "assistant" | "system";

export type DirectPattern =
  | { kind: "regex"; source: string; caseSensitive?: boolean }
  | { kind: "literal"; value: string; caseSensitive?: boolean };

export interface PatternSet {
  all?: readonly DirectPattern[];
  any?: readonly DirectPattern[];
  none?: readonly DirectPattern[];
}

export interface ContentRequirement {
  id: string;
  types: readonly ContentType[];
  roles?: readonly ContentRole[];
  text: PatternSet;
}

export interface ContentRequirements {
  all?: readonly ContentRequirement[];
  any?: readonly ContentRequirement[];
  none?: readonly ContentRequirement[];
}

export interface DirectQualification {
  title?: PatternSet;
  content?: ContentRequirements;
}

export type DirectEvidenceRequest =
  | { kind: "none" }
  | {
      kind: "first-positive-content-witness";
      maxCharacters: number;
      prefer?: readonly string[]; // requirement IDs; omitted IDs follow declaration order
    };

export interface DirectSearchRequest {
  selector: SessionSelector;
  qualification: DirectQualification;
  evidence: DirectEvidenceRequest;
  order: "updated-desc";
  limit: number;
}

export interface DirectSearchHit {
  backend: "direct";
  session: SessionSummary;
  evidence?: {
    kind: "content-witness";
    requirementId: string;
    text: string;
    contentId: string;
    role: ContentRole;
    type: ContentType;
    ordinal: readonly [major: number, minor: number];
    layout: "v1-part" | "v2-session-message";
  };
}

export interface HistoryRequest {
  selector: SessionSelector;
  countSince: number;
  limit: number;
}

export interface ResolveRequest {
  selector: SessionSelector;
  mode: "latest" | "only";
}

export interface IndexedSearchRequest {
  selector: SessionSelector;
  query: FtsQuery;
  evidence: "none" | "highlight";
  order: "relevance" | "updated-desc";
  limit: number;
}

export type FtsQuery =
  | { kind: "terms"; terms: readonly string[]; combine: "all" | "any" }
  | { kind: "phrase"; value: string }
  | { kind: "advanced"; expression: string };
```

The syntax deliberately changes current `TextPattern.mode` into a discriminated
union. `{kind: "literal", value}` cannot accidentally be treated as regex source,
and a future FTS expression cannot be added to `DirectPattern` without an
obviously dishonest type change.

### Invariants And Validation

1. Populated selector fields compose by AND. Values inside `ids` and
   `projectIds` compose by OR.
2. Selector arrays are non-empty, duplicate-free, and contain no empty values.
3. Directory values are non-empty. Directory mode is explicit.
4. Time endpoints are finite and a two-ended range satisfies `from < to`.
5. A `PatternSet` has at least one present group; every present group is
   non-empty; patterns are non-empty; regexes compile during validation.
6. A `ContentRequirements` value has at least one present non-empty group.
7. Requirement IDs are non-empty and unique across `all`, `any`, and `none`.
8. Requirement types are non-empty and unique. Populated roles are non-empty and
   unique.
9. `DirectQualification` contains title, content, or both. Neither means an
   invalid search request, not “all sessions.”
10. Title and content fields compose by AND.
11. Evidence may reference only IDs in positive `all` or `any` groups. Unknown,
    duplicate, or negative IDs in `prefer` are invalid.
12. Evidence preference is not a qualification condition. The executor checks
    preferred positive requirements in order, then remaining positive `all` and
    `any` requirements in declaration order, choosing the first one with a
    witness.
13. Requesting content evidence requires at least one positive `all` or `any`
    content requirement. It is invalid for title-only or negative-content-only
    qualification because no positive content witness qualified the session.
    Title evidence can be introduced as a distinct result variant if a real
    consumer needs it.
14. Limits obey each operation's declared compatibility semantics. They are not
    hidden in a universal `Window` merely to look uniform.
15. Unsupported type/role/layout combinations fail before execution. Validation
    of shape does not imply every backend supports every valid semantic value.

### Truth And Witness Semantics

For session `s`:

```text
qualifiesDirect(s, request) =
  matchesSelector(s, request.selector)
  AND (title absent OR matchesPatternSet(s.title, title))
  AND (content absent OR matchesContentRequirements(s, content))
```

For a content unit `u` and requirement `r`:

```text
witnesses(u, r) =
  u belongs to s
  AND u.type is in r.types
  AND (r.roles absent OR u.role is in r.roles)
  AND matchesPatternSet(u.text, r.text)
```

For either bounded group level:

```text
all  = every member is true
any  = at least one member is true
none = every member is false
present groups compose by AND
```

At pattern level, “member” is a pattern evaluated on the same string. At
requirement level, “member is true” means `exists u: witnesses(u, requirement)`.
Each requirement gets its own existential quantifier. This is why separate
requirements can use different units while several patterns inside one
requirement cannot.

### Where Title Belongs

Title belongs in `DirectQualification`, not `SessionSelector` and not a mutually
exclusive `DirectMatch` union.

- It is physically session metadata, but semantically it is a text match using
  the direct backend's pattern language.
- History, resolution, and bulk metadata selection do not currently need text
  matching and should not inherit regex capability merely because title is a
  session column.
- Putting title beside content permits the ordinary and required conjunction
  “title matches X and related content matches Y.”
- Keeping it outside content preserves its one-value witness scope and avoids
  inventing a synthetic title content unit.

If title matching later becomes a reusable non-search selector, promote a
backend-neutral title predicate only after its semantics are defined. Do not
move direct regex into the metadata spine preemptively.

### Evidence Without Positional Magic

Stable requirement IDs identify semantic sources. Array order remains useful as
a deterministic default preference, but it is not identity.

For a query with positive requirements `objective` and `same-witness`, a hit may
return:

```ts
evidence: {
  kind: "content-witness",
  requirementId: "objective",
  text: "the actual objective is the selector object model",
  contentId: "part_123",
  role: "user",
  type: "text",
  ordinal: [42, 0],
  layout: "v2-session-message",
}
```

Renaming or reordering requirements is visible and deliberate. Inserting a new
array element cannot silently change what `requirement: 0` means. Negative
requirements cannot appear in evidence preference. For an `any` group, only the
requirements that actually matched are eligible, so evidence always describes a
positive qualifying witness.

### Complete Examples

#### Metadata-only history with distinct cutoffs

```ts
const request: HistoryRequest = {
  selector: {
    directory: { mode: "contains", value: "/src/cotail" },
    updated: { from: sessionCutoff },
  },
  countSince: messageCutoff,
  limit: 0, // current history compatibility: unlimited
};
```

`sessionCutoff` controls membership. `messageCutoff` controls an aggregate.
Neither is inferred from the other.

#### Exact identity and project resolution

```ts
const request: ResolveRequest = {
  selector: { ids: [sessionId], projectIds: [projectId] },
  mode: "only",
};
```

#### Two terms on different units

```ts
const request: DirectSearchRequest = {
  selector: {},
  qualification: {
    content: {
      all: [
        { id: "opencode", types: ["text"], text: { all: [{ kind: "regex", source: "opencode" }] } },
        { id: "journal", types: ["text"], text: { all: [{ kind: "regex", source: "journal" }] } },
      ],
    },
  },
  evidence: { kind: "first-positive-content-witness", prefer: ["opencode"], maxCharacters: 200 },
  order: "updated-desc",
  limit: 50,
};
```

#### Two patterns on one user-text unit

```ts
const request: DirectSearchRequest = {
  selector: {},
  qualification: {
    content: {
      all: [{
        id: "same-unit",
        types: ["text"],
        roles: ["user"],
        text: {
          all: [
            { kind: "literal", value: "scope" },
            { kind: "literal", value: "selector" },
          ],
          none: [{ kind: "literal", value: "implementation roadmap" }],
        },
      }],
    },
  },
  evidence: { kind: "first-positive-content-witness", maxCharacters: 240 },
  order: "updated-desc",
  limit: 20,
};
```

#### Requirement OR, session-wide exclusion, and title conjunction

```ts
const request: DirectSearchRequest = {
  selector: { projectIds: ["cotail"], updated: { from: start, to: end } },
  qualification: {
    title: {
      any: [
        { kind: "literal", value: "query" },
        { kind: "literal", value: "selector" },
      ],
    },
    content: {
      any: [
        { id: "scope", types: ["text"], text: { all: [{ kind: "literal", value: "scope" }] } },
        { id: "witness", types: ["reasoning"], text: { all: [{ kind: "literal", value: "witness" }] } },
      ],
      none: [{
        id: "obsolete",
        types: ["text", "reasoning"],
        text: { any: [{ kind: "literal", value: "superseded" }, { kind: "literal", value: "deprecated" }] },
      }],
    },
  },
  evidence: { kind: "first-positive-content-witness", prefer: ["witness", "scope"], maxCharacters: 200 },
  order: "updated-desc",
  limit: 50,
};
```

### History And Resolution

History and resolution use `SessionSelector`; they do not use
`DirectQualification`.

- History adds canonical message-count projection and its own order/limit rules.
- Resolution adds cardinality policy (`latest` or `only`). Exact ID and exact
  directory remain ordinary selector values, although convenience functions may
  exist at the API edge.
- Neither operation gains content witnesses, search evidence, FTS ranking, or
  regex merely to fit one universal query type.
- If a future history feature filters by message count, that is a new
  aggregate-qualified history request, not a reason to retroactively call counts
  metadata.

### Direct And FTS: Shared And Deliberately Separate

They share:

- `SessionSelector` semantics to the extent each store can honor and recheck
  populated fields;
- session identity and normalized summaries;
- session-root result cardinality; and
- the broad distinction between qualification and returned evidence.

They do not share:

- `DirectPattern` or `FtsQuery` syntax;
- regex, token, phrase, stemming, prefix, or escaping semantics;
- witness order versus relevance rank;
- direct excerpts versus FTS highlights;
- score meaning; or
- compiled plans.

An indexed backend may use copied selector fields for candidate pruning, but
live metadata remains authoritative under [`authority0.md`](/query/authority0.md).
That authority rule constrains execution; it does not enlarge the query model.

### Lowering Proof Sketches

Metadata selection lowers to outer session predicates:

```sql
WHERE s.project_id IN ($project0, $project1)
  AND instr(s.directory, $directory) > 0
  AND s.time_updated >= $updated_from
  AND s.time_updated < $updated_to
```

Title qualification adds predicates on the same outer row:

```sql
AND re($title0, s.title, $title0_case)
```

Each `content.all` requirement lowers to a separate correlated `EXISTS`; all
predicates inside one requirement stay inside that subquery:

```sql
AND EXISTS (
  SELECT 1
  FROM searchable_content AS u
  WHERE u.session_id = s.id
    AND u.content_type IN ($type0)
    AND u.role IN ($role0)
    AND re($same_a, u.text, 0)
    AND re($same_b, u.text, 0)
)
```

`content.any` lowers to one parenthesized OR of correlated `EXISTS` clauses.
Each `content.none` member lowers to correlated `NOT EXISTS`. Pattern-level
`none` remains `NOT re(...)` inside one witness subquery. Qualification and
evidence reuse the same private requirement-predicate constructor.

Evidence checks positive requirements in declared preference order and selects
the earliest canonical witness. The projection includes the selected
`requirementId`; IDs are domain values, not SQL aliases or binding positions.
Current V1/V2 owner selection determines the private `searchable_content`
relation and canonical ordering. No public type names physical layouts except
the returned evidence provenance, where the distinction is factual and useful.

These shapes are already close to the current Kysely lowering in
[`content.ts`](/packages/opencode-live-store/src/query/content.ts). The proof does
not require a public planner or a migration chronicle.

## Pressure Tests

| Pressure | Fit or break |
|---|---|
| Project | Fits `SessionSelector.projectIds`; values are OR, other fields AND. |
| Date range | Fits half-open `selector.updated`; created time can be added as a distinct selector field when required. |
| Role | Fits on `ContentRequirement`; therefore it is bound to the same witness as type and text. Unsupported layouts reject it. |
| Pattern OR | Fits `PatternSet.any` on one value. |
| Requirement OR | Fits `ContentRequirements.any` over independently witnessed alternatives. |
| Pattern negation | Fits `PatternSet.none`; it constrains the chosen witness value. |
| Requirement negation | Fits `ContentRequirements.none`; it asserts absence of any witness for each excluded requirement. |
| Phrase | Direct phrase intent is an escaped literal/adjacency policy only if explicitly defined; FTS phrase remains `FtsQuery.kind: "phrase"`. Do not put a universal `phrase` in shared match types. |
| Title + content | Fits as sibling fields in `DirectQualification`, composed by AND. Current mutual exclusion is a deliberate initial-scope restriction, not the target model. |
| Future message search | If results remain sessions and messages merely witness qualification, add a bounded message requirement relation only after its unit semantics are defined. If results are messages, create `MessageSearchRequest` with message roots instead. |
| Future content-unit operation | A command returning individual units needs `ContentSearchRequest` and content-root ordering/window semantics; do not turn `DirectSearchRequest` into a root switch. |
| Title OR content | **Breaks intentionally.** Neither bounded group is the common scope for this expression. |
| `(title A AND content B) OR (project C AND NOT content D)` | **Breaks intentionally.** This is the clear recursive-composition case. |
| Aggregate-qualified search | **Breaks intentionally.** It crosses session, related witnesses, and aggregate predicates. |

### Threshold For A Recursive AST Or Planner

A recursive logical AST becomes justified when a committed operation requires
**user-controlled nesting across relation boundaries**, not merely OR or
negation within one existing scope. One real requirement such as title OR
content is enough to prototype an internal relation-aware AST. It becomes a
public domain model only if at least two independently useful operations need to
construct or serialize that composition and direct plus indexed lowering can
state honest capability rules for it.

The likely leaf vocabulary would remain closed (`SessionPredicate`,
`TitlePredicate`, `ExistsContent`, perhaps `AggregatePredicate`), with explicit
`and`/`or`/`not`. A planner is separately justified when execution must split one
logical expression across live metadata and an index, preserve ranking, and
recheck candidates. Do not introduce either merely because nested TypeScript
unions are aesthetically possible.

## Current Implementation Delta

The current domain in [`packages/query-domain/src`](/packages/query-domain/src/index.ts)
is close to the recommendation:

| Current object | Recommended interpretation / delta |
|---|---|
| `SessionSelector` | Keep. It already has IDs, projects, explicit directory mode, and half-open updated range. “Selector” is the right name. |
| `TextPattern {source, mode?}` | Replace semantically with a discriminated direct regex/literal union when changing the API; current optional defaults are concise but blur matcher identity. |
| `PatternSet` | Keep `all`/`any`/`none` and current present-group conjunction semantics. |
| `ContentRequirement` | Keep nested witness boundary; add stable `id`. Types/roles/text already correctly share one witness. |
| `ContentRequirements` | Keep bounded `all`/`any`/`none`; IDs must be unique across groups. |
| `DirectSearchRequest.title` + `.requirements` | Rename/group under `qualification` when an API break is acceptable, and allow both. Current validation error “title and content search cannot be combined” is an initial implementation-scope constraint, not intended target semantics. |
| `evidence: boolean` | Replace with explicit evidence policy and return populated provenance. Current lowering already chooses positive `all` then `any`, but the request cannot name preference and returned optional provenance is not populated. |
| `DirectSearchHit.evidence.requirement {scope,index}` | Replace positional `{scope,index}` with `requirementId`. Keep concrete content identity, layout, and ordinal. |
| `HistoryRequest` | Keep operation-shaped. `countSince` is correctly separate from `selector.updated`. |
| `ResolveRequest` | Keep operation-shaped. `mode` is cardinality policy, not selection. |

The current implementation's most important naming debt is that `requirements`
means content requirements while `title` is a sibling qualification field. The
recommended `qualification: {title, content}` makes the common AND explicit.
Their mutual exclusion in
[`validation.ts`](/packages/query-domain/src/validation.ts) records a deliberate
initial-scope deferment that has become target-model debt. A more accidental
type/implementation drift is that `DirectSearchHit` declares rich witness
provenance while current lowering returns only `evidenceText`. Neither point
requires changing storage authority or query-builder architecture.

## Open Decisions For Judgment

1. **Qualification wrapper.** Choose `qualification: {title, content}` for
   explicit grouping, or retain top-level `title` / `requirements` and merely
   remove mutual exclusion. The wrapper is clearer; top-level fields are the
   smallest migration.
2. **Requirement IDs.** Require caller-supplied stable strings, or assign IDs in
   a constructor from caller labels. Caller-supplied IDs make serialized requests
   and evidence durable; constructors reduce CLI ceremony.
3. **Evidence preference.** Accept the recommended ordered `prefer` IDs with
   deterministic fallback, or allow exactly one required `all` ID. Ordered
   preference handles `any`; exact `all` is simpler but less expressive.
4. **Evidence detail.** Guarantee only `requirementId + text`, or guarantee
   content ID, role, type, ordinal, and layout too. Rich provenance is more
   inspectable but requires every supported layout to produce stable identities.
5. **Pattern representation.** Adopt the discriminated regex/literal union, or
   retain `{source, mode?}` defaults. The union is more honest for future FTS;
   the current shape is terser and already validated.
6. **Title evidence.** Keep title-only results without evidence, or add a
   distinct `{kind: "title-witness"}` projection. Add it only for a real renderer
   or API consumer; the title is already returned in the session summary.
7. **Created-time selector.** Add `created` beside `updated` now for symmetry, or
   wait for a concrete query. Waiting preserves the closed vocabulary without
   blocking later addition.
8. **AST trigger.** Confirm that title OR content is out of scope until a concrete
   operation requires it. Accepting it now commits the project to a
   relation-aware recursive model and backend capability work.

## Model Acceptance Criteria

Accept this object model when reviewers can answer all of these from request
values and tests, without reading SQL:

- whether session metadata fields compose by AND and set values by OR;
- whether two terms may use different content units or must share one;
- whether role/type/text apply to the same witness;
- whether exclusion means “this witness text does not match” or “no witness in
  this session matches”;
- whether title and content can qualify one session together;
- which positive requirement produced evidence, without relying on array index;
- why enabling/disabling evidence cannot change session membership;
- why history's session cutoff and message-count cutoff are different values;
- which operations reuse `SessionSelector` and which do not reuse search
  qualification;
- why a direct regex request cannot be sent to FTS and an FTS expression cannot
  be sent to direct search;
- what invalid values fail during domain validation and what valid values may
  still fail backend capability checks;
- where future project, date, role, OR, exclusion, and phrase features fit; and
- exactly which cross-relation expressions exceed the bounded model and trigger
  an AST/planner reassessment.

Executable semantic acceptance should include fixtures for selector conjunction,
title patterns, title plus content, independent witnesses, same witness,
pattern-level `any`/`none`, requirement-level `any`/`none`, role/type binding,
positive evidence IDs, evidence invariance, history cutoff separation, and
unsupported direct/FTS request rejection. Tests should assert results and
provenance, not complete SQL strings.

## Best-Of-Breed Lineage

- [`prompt0.gpt56sol.md`](/query/prompt0.gpt56sol.md) is the original problem
  statement. It matters because it names relation ranges, independent witnesses,
  evidence, aggregates, and backend inequivalence as the design questions.
- [`draft1.syn.md`](/query/draft1.syn.md) is the prior cross-assessment feeding
  this design, not discarded history. It settled the session root,
  operation-shaped direction, bounded witness vocabulary, private lowering, and
  honest backend split. Its recommendation is refined here around title
  conjunction and evidence identity.
- [`draft1.gpt56sol.md`](/query/draft1.gpt56sol.md) is superseded as the current
  recommendation but remains the strongest operation-shaped refinement. Its
  structural same-witness model and narrow selector are retained; its positional
  evidence and deferred title/content conjunction are replaced.
- [`design-alt0.ds4f.md`](/query/design-alt0.ds4f.md) is a non-selected
  relation-tagged alternative. Its durable contribution is forcing witness
  grouping and named evidence sources into the discussion. Stable requirement
  IDs are adopted; relation tags, caller-managed groups, content-root framing,
  and public plan are rejected for now.
- [`design-alt0.glm52.md`](/query/design-alt0.glm52.md) is non-selected as a full
  model but supplies essential prior art under candidate A: the selection spine,
  separate projection axis, backend-owned match semantics, and live metadata
  authority. Its flat content match is replaced by nested requirements.
- [`draft0.gpt56sol.md`](/query/draft0.gpt56sol.md) is superseded as the current
  model. Its durable contribution is the clear session/requirements/projection
  vocabulary and first explicit `SessionQuery` envelope assessed as candidate C.
- [`design-alt0.gpt56sol.md`](/query/design-alt0.gpt56sol.md) is superseded by
  `draft1` and this document, but introduced the best initial
  operation-shaped/nested-witness object model.
- [`draft-ksyley1.md`](/query/draft-ksyley1.md) is superseded as object-model
  guidance. Its useful concrete evidence is that the current contracts use
  bounded groups and operation requests; its package, Kysely, and index roadmap
  are deliberately outside this adjudication's center.
- [`packet-query-builders0.md`](/query/packet-query-builders0.md) promoted the
  prior synthesis's witness boundaries, both bounded boolean scopes, positive
  evidence, and cross-relation-AST exclusion into non-negotiable implementation
  criteria. It matters as confirmation that these semantics were already
  settled before this recovery pass.
- [`authority0.md`](/query/authority0.md) is normative only for what canonical
  session and content rows may witness a query. It must constrain lowering, but
  it must not turn storage migration concepts into public query objects.
- [`implementation4.md`](/query/implementation4.md) records current executable
  reality and confirms that the bounded witness model is implementable. It is
  not the intended object-model design and does not settle the remaining API
  choices by itself.
- [`design1.md`](/query/design1.md) is deprecated as a failed, off-target
  synthesis. It centered implementation and FTS progression rather than
  adjudicating the selector/qualification object model.

## Provisional Recommendation

Use a narrow `SessionSelector` inside operation-shaped requests. For direct
search, define complete qualification as selector AND optional title pattern set
AND optional content requirements. Keep two bounded, non-recursive boolean
scopes: patterns over one value and requirements over independently quantified
content witnesses. Bind role/type/text inside one requirement. Give every
requirement a stable ID and return that ID with positive evidence. Keep history
aggregates and resolution cardinality operation-specific. Give FTS its own query
language and evidence contract.

This recovers the design that was already mostly settled while correcting its
remaining weak seams. The next judgment is not “what query architecture should
we invent?” It is whether the qualification wrapper, stable requirement IDs,
and evidence preference policy are the right final public spelling.
