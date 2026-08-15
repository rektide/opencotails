---
type: Prompt
title: Kysely-forward V2 query library design
description: Prompt for designing cotail as a V2-only, Effect-composed CLI and reusable query library that uses Kysely as much of its public query model.
resource: /query/prompt1.gpt56.md
tags: [cotail, query, kysely, effect, opencode, v2, cli, library, identity]
status: draft
generated: { by: model:openai/gpt-5.6, at: 2026-08-15T00:00:00Z }
stale_after: 2026-11-15
sources:
  - id: original-query-prompt
    resource: /query/prompt0.gpt56sol.md
    title: Original cotail query architecture prompt
  - id: prior-query-synthesis
    resource: /query/draft1.syn.md
    title: Cross-assessment of the first query-model wave
  - id: kysely-proposal
    resource: /query/draft-ksyley0.md
    title: Executable Kysely query architecture
  - id: kysely-refinement
    resource: /query/draft-ksyley1.md
    title: Refined private-Kysely architecture
  - id: kysely-selection-spike
    resource: /.test-agent/query-kysely-selection/README.md
    title: Kysely as the selection object model
  - id: opencode-v2-model
    resource: /query/opencode-v2-model0.general.md
    title: OpenCode V2 model and integration research
  - id: storage-authority
    resource: /query/authority0.md
    title: Mixed-layout authority research
  - id: bookmark-model
    resource: /bookmarks/draft2.glm52.md
    title: Pointer and composite bookmark model
---

# Kysely-Forward V2 Query Library Design Prompt

## Assignment

Design the next cotail query architecture.

Cotail must remain a useful command-line utility, become a reusable TypeScript
library, and leave a credible path to running inside OpenCode itself. The design
should use Kysely aggressively as the programmable relational query model rather
than recreating selection, boolean composition, joins, projection, grouping,
ordering, and windowing in a parallel cotail DTO algebra.

This is not a request to polish the current `SessionSelector` model. Reopen the
earlier decision that Kysely must remain private. Determine how much of Kysely's
public expression and query-builder model should become part of cotail's shared
library, and identify the smaller set of semantics that cotail genuinely must
own.

The design must be ambitious, executable, and grounded in the current OpenCode
V2 source. Do not optimize for the smallest or safest-looking API. Optimize for
a coherent and delightful model that gives library users real relational power
without abandoning cotail's domain responsibilities.

## Product Situation

Cotail currently searches OpenCode's SQLite database through a standalone CLI.
It supports direct session content/title search, history, and session resolution.
The implemented query layer uses Kysely internally but exposes custom
`SessionSelector`, `PatternSet`, and `ContentRequirements` objects.

That implementation proved several important facts, but it does not settle the
future object model:

- cotail is still a CLI application first;
- a reusable library API is desirable;
- the same library may eventually be linked into OpenCode as an internal package,
  CLI command, or server endpoint;
- OpenCode V2 is Effect-based and provides useful source schemas and services;
- OpenCode's existing Session API is not a sufficient cross-session search or
  multi-grain result model;
- Kysely already supplies a rich typed relational object model; and
- cotail still needs semantics Kysely cannot infer, especially identity,
  witnesses, evidence, capabilities, and result packaging.

## Settled Direction

Treat the following as design inputs unless source evidence demonstrates a
serious contradiction.

### OpenCode V2 only

The new architecture reads only OpenCode V2 projected storage.

- Require `session_v2` and `session_message` capabilities.
- Reject V1-only databases.
- If preserved legacy rows exist, require the completed V1-to-V2 migration state
  before reading.
- Never query, union, reconcile, or fall back to V1 `session`, `message`, or
  `part` rows.
- Treat optional event persistence as a capability, not as the canonical source
  of transcript history.

Physical V1 tables may remain after migration. "V2 only" describes cotail's
authority and read behavior, not an assertion that legacy tables are absent.

### Kysely-forward shared library

Kysely should provide as much of the shared programmable query model as it can
model honestly:

- typed relational selection;
- boolean expressions;
- joins and correlated subqueries;
- `exists` and `not exists`;
- projection;
- grouping and aggregates;
- ordering;
- window functions and per-group limits;
- CTEs and logical relation composition; and
- compilation and bound parameters.

Do not introduce a second closed predicate/query AST merely to lower it into
Kysely. Cotail may provide convenient expression factories, query transforms,
logical relation helpers, seeded query contexts, or higher-level operations, but
those should compose through ordinary Kysely concepts rather than replace them.

The exact API is deliberately open. Investigate expression factories, immutable
query transforms, seeded/narrowed `SelectQueryBuilder` contexts, and combinations
of those approaches. Do not assume the previous "Kysely stays private" rule.

### Effect-composed program

Use Effect Services and Layers where they create real architectural value:

- configuration;
- database and query-service lifecycle;
- capabilities;
- typed operational errors;
- tracing and observability;
- composition of standalone CLI and embedded OpenCode runtimes;
- resource scopes; and
- replaceable test implementations.

Do not wrap pure Kysely expression construction in Effect merely for uniformity.
Kysely should remain the relational language underneath Effect-owned services.

### Search all V2 projected content and optional event history

The initial model should permit searching all authoritative projected content
that can be represented responsibly, including:

- user text;
- assistant text;
- reasoning;
- tool calls, inputs, outputs, and errors;
- shell commands and outputs;
- attachments/files and their metadata;
- system and synthetic content;
- skills, compaction, agent changes, and model changes;
- pending input where it is part of the readable projection;
- message metadata;
- session metadata; and
- relevant project, workspace, and location metadata.

Optional persisted events are a separate capability and result source, not
projected content. When available they may also be searchable, but the design
must not require them for canonical Session or transcript queries.

Do not begin by prohibiting these categories because their final filter grammar
or redaction controls are incomplete. Model them and expose their provenance.
Additional filtering, constraints, privacy controls, and refined canonical-text
policies may be layered in later. The design must still identify obvious safety
and data-exposure risks. Inventory every V2 Message variant and relevant
projected metadata relation, and give an explicit searchable/non-searchable
rationale rather than silently omitting inconvenient categories.

### Multiple result grains

Do not force every operation into one result per session. The architecture must
consider at least:

- Session results;
- Message results;
- nested content-item results;
- tool-call results;
- shell-execution results;
- grouped Session results containing ordered child hits;
- aggregate/history rows;
- optional persisted Event results; and
- durable bookmark/reference results.

Support multiple results per Session and explicit per-Session limits. SQLite
window functions are available and should be considered. Do not rely on
PostgreSQL-style `LATERAL`, which the investigated SQLite runtimes do not support.

## The Central Modeling Challenge

Produce an excellent shared address/identity model for these grains.

Do not assume the answer is named `Pointer`, `Reference`, `Target`, `Address`,
`Locator`, or `Link`. Study the domain and choose terminology that fits.

The model must account for facts such as:

- OpenCode supplies branded Session, Message, Event, and other identifiers;
- message ownership remains meaningful even when a message ID is globally
  unique in storage;
- assistant text and reasoning content-array items lack upstream IDs;
- content items have stable order through message sequence plus array position;
- tool calls have their own IDs but also occupy content positions;
- parent continuation and explicit fork lineage are different relations;
- a bookmark may outlive or intentionally snapshot mutable source data; and
- a live source row, a query hit, evidence, and a stored bookmark are not the
  same object.

The shared identity should give different result products something meaningful
to share without becoming a universal bag of optional fields. Explain which
identities are source-native, which are cotail-derived, which are durable, and
which require provenance or version information.

## Source Material To Reconcile

Read these as evidence with different authority, not as instructions to combine
all previous conclusions.

### Foundational problem and alternatives

- [`prompt0.gpt56sol.md`](/query/prompt0.gpt56sol.md) asks the original questions
  about selection, related content, evidence, aggregates, and backend semantics.
- [`draft0.gpt56sol.md`](/query/draft0.gpt56sol.md) proposes a typed SessionQuery
  envelope.
- [`design-alt0.ds4f.md`](/query/design-alt0.ds4f.md) explores relation-tagged
  selection, named witnesses, and a plan object.
- [`design-alt0.glm52.md`](/query/design-alt0.glm52.md) identifies selection,
  matching, and projection as separate axes.
- [`design-alt0.gpt56sol.md`](/query/design-alt0.gpt56sol.md) proposes
  operation-shaped requests and bounded related-row witnesses.
- [`draft1.syn.md`](/query/draft1.syn.md) cross-assesses that wave. Its conclusions
  are prior work, but its session-only and private-lowering assumptions are now
  explicitly open.

### Kysely evaluation and implementation evidence

- [`draft-ksyley0.md`](/query/draft-ksyley0.md) proves Kysely expression builders,
  correlated subqueries, CTEs, JSON extraction, and `node:sqlite` execution.
- [`draft-ksyley1.md`](/query/draft-ksyley1.md) refines package and lifecycle
  architecture but makes the "Kysely is private" decision now under review.
- [`draft-drizzle0.md`](/query/draft-drizzle0.md) remains useful counterevidence
  about schema ergonomics and native-driver costs.
- [`implementation4.md`](/query/implementation4.md) separates proposal evidence
  from what actually shipped.
- [`.test-agent/query-kysely-selection/README.md`](/.test-agent/query-kysely-selection/README.md)
  directly prototypes Kysely expression factories, query transforms, and a
  store-seeded logical context. Treat it as a starting experiment, not a verdict.

### OpenCode V2 and identity research

- [`opencode-v2-model0.general.md`](/query/opencode-v2-model0.general.md) audits the
  current `~/a/a/opencode` V2 source, Effect architecture, persistence, result
  grains, extension seams, and V1-removal consequences.
- [`authority0.md`](/query/authority0.md) explains why legacy residue cannot be
  unioned. Preserve that migration-safety lesson while removing dual-layout
  query behavior.
- [`bookmarks/draft2.glm52.md`](/bookmarks/draft2.glm52.md),
  [`draft3.glm52.md`](/bookmarks/draft3.glm52.md), and
  [`draft4.glm52.md`](/bookmarks/draft4.glm52.md) explore Pointer, Composite,
  lineage, descriptor, snapshot, and capability concepts. Mine their distinctions
  but do not inherit their names or universal Composite automatically.

### Candidate to challenge

- [`design2.md`](/query/design2.md) is an unaccepted custom selector/
  qualification candidate. Assess what domain semantics it identified correctly,
  but do not accept its narrow `SessionSelector` and bounded DTO algebra merely
  because it is the newest numbered design.
- [`design1.md`](/query/design1.md) is deprecated and off-target. It is not a
  design input except as a warning against replacing the object-model problem
  with an implementation roadmap.

Also inspect current source and tests rather than trusting documents where they
disagree. Inspect the current OpenCode V2 checkout at `~/a/a/opencode` and the
canonical Kysely checkout at `~/archive/kysely-org/kysely` before using web
sources.

## Questions The Design Must Answer

### Logical V2 query world

1. What stable logical relations should the library expose over OpenCode V2?
2. Which fields and identities belong to Session, Message, content, tool, shell,
   project, lineage, attachment, and optional Event relations?
3. Should logical relations be CTEs, store-seeded builders, internal views,
   Kysely table types, or another composition?
4. How are nested JSON content arrays flattened while retaining identity,
   provenance, order, and source shape?
5. How does the library evolve its logical schema without coupling callers to
   unstable physical tables?

### Kysely API

6. What does a library user receive and return: an `ExpressionBuilder`, an
   expression factory, a query transform, a seeded builder, or a richer context?
7. Can users select arbitrary result grains and projections while cotail still
   guarantees canonical relations and safe execution?
8. Which useful helpers should cotail provide without creating a competing
   algebra?
9. How are reusable selections and witness queries made safe across aliases and
   query scopes?
10. Is Kysely a direct public dependency of the reusable API, and what versioning
    commitment follows?
11. Where should raw `sql`, plugins, compiled queries, and `EXPLAIN` be available?

### Identity, witnesses, and results

12. What common identity/address model spans source entities and derived nested
    items without confusing identity with descriptor or evidence?
13. How does a query identify the witness that both qualifies a result and
    supplies evidence without duplicating predicate logic or relying on array
    positions in the request?
14. Which result products should be distinct, and what structural core should
    they share?
15. How are grouped Session results, multiple child hits, per-Session limits,
    global limits, ordering, and pagination represented?
16. How do bookmarks refer to, snapshot, and later resolve live or missing
    targets?
17. Where do rank, evidence, highlights, source provenance, freshness, and
    capabilities live?

### Search semantics

18. How does the model distinguish filtering, matching, scoring, evidence,
    projection, aggregation, ordering, and windowing?
19. How are direct regex/literal matching and future FTS-native matching exposed
    without semantic pretending?
20. How is all V2 content made searchable while retaining source-specific fields
    and provenance rather than flattening everything irreversibly into one text
    blob?
21. What privacy/redaction/cost controls are required immediately, and which can
    be layered later without redesigning identity or results?
22. What consistency or snapshot guarantees are needed when OpenCode writes while
    cotail queries or hydrates results?

### Effect and integration

23. What Effect Services, Layers, Scopes, errors, configuration, and tracing
    should the reusable library own?
24. Which components remain pure Kysely construction functions?
25. How does the standalone CLI compose the library without becoming a special
    architecture?
26. How could the same services later run inside OpenCode without bypassing its
    Effect SQL transaction/serialization discipline?
27. Which eventual upstream seam is strongest: internal package and CLI command,
    server endpoint, or embedded SDK host? Do not choose the current plugin API
    unless source changes make it capable.

## Required Executable Exploration

Do not settle the design through prose alone. Build isolated prototypes under
`.test-agent/` using the installed Kysely and Effect versions without changing
production manifests.

Prototype at least two genuinely ambitious public API shapes. One must expose a
store-seeded or otherwise logical Kysely query context. Another should explore
reusable contextual expression factories and query transforms. A third may be
included if it exposes a materially different amount of query authority.

Both prototypes must type-check and execute against one shared synthetic V2-only
SQLite fixture. Keep them thin: collectively demonstrate the decisions whose
feasibility would otherwise remain speculative:

- Message and nested-content result grains across Sessions;
- a configurable per-Session top-N using a window function;
- correlated independent-witness and same-witness selection;
- evidence projection reusing the qualifying witness construction; and
- the proposed shared identity/address values for Session, Message, nested
  content, and tool results.

Record generated SQL, result shapes, output types, and where Kysely needed raw
SQL. Ordinary typed API paths must expose only the logical V2 relations. Raw SQL
is an explicit trusted escape hatch that can bypass that type boundary and must
be documented as such, not falsely claimed safe by logical-schema typing.

The complete content inventory, bookmarks, Effect Layer composition, aggregate
products, and OpenCode embedding may remain design-level examples and acceptance
criteria unless a small additional spike is necessary to resolve a disputed
claim.

## Alternatives To Assess Fairly

At minimum compare:

1. Kysely contextual expression factories as the reusable selection value.
2. Immutable Kysely query transforms.
3. A store-seeded logical `SelectQueryBuilder` or query context.
4. A coherent combination of these at different levels.
5. The current custom selector/request DTO approach as a baseline, not the
   default.

You may recommend another shape if it uses Kysely's model more effectively.

Evaluate conceptual power, ergonomics, type inference, discoverability,
composability, output typing, alias safety, evidence identity, testability,
Effect integration, public semver coupling, CLI construction, OpenCode embedding,
and ability to support multiple result grains.

Do not reward an option simply for exposing fewer operations. Power is valuable
when it is coherent and well modeled.

## Explicit Non-Goals

- Supporting OpenCode V1 reads.
- Preserving the existing custom selector DTOs for compatibility; the project is
  pre-1.0.
- Migrating OpenCode from Drizzle/Effect SQL to Kysely.
- Using OpenCode's optional event log as the only transcript source.
- Designing the complete future FTS index implementation.
- Treating one result per Session as universal.
- Creating a backend-neutral search language that erases regex/FTS differences.
- Inventing a generic query AST that merely duplicates Kysely.
- Choosing a weak API because it appears easier to stabilize.

## Requested Design Deliverable

Produce a source-backed design that includes:

1. A concise thesis, settled/proposed boundary, and domain vocabulary grounded in
   OpenCode V2, including the recommended shared identity/address model.
2. The logical V2 relation schema, searchable-content inventory, source
   provenance, and stability policy.
3. The recommended Kysely-forward public API with complete TypeScript examples
   and comparison to the executable prototypes.
4. Result-grain, grouping, per-Session-limit, evidence, bookmark/reference, and
   pagination semantics.
5. The Effect Service/Layer architecture, standalone CLI composition root, and a
   credible later OpenCode embedding route.
6. A migration map emphasizing removable V1/custom-query machinery.
7. Open questions plus behavioral and type-level acceptance criteria.
8. Explained lineage links distinguishing retained evidence from superseded
   conclusions.

The document should stand alone, but it should not repeat the entire historical
corpus. Use prior work as evidence and focus the reader on the proposed model.

## Success Criteria

A strong response will make it possible to answer, by reading types and examples:

- What can a library user query?
- Which parts are ordinary Kysely?
- Which parts are cotail domain semantics?
- What identifies every returned thing?
- How can one Session produce several ordered results?
- How are per-Session and global limits different?
- How does evidence remain attached to qualification?
- How does the CLI consume the same library OpenCode may later host?
- What complexity disappeared with V1 and the custom predicate algebra?
- What remains genuinely hard?

Prefer an architecture that opens useful possibilities over one that closes them
preemptively. The goal is not to protect cotail from relational querying. The
goal is to give it an excellent relational model, a strong runtime architecture,
and domain semantics worthy of the data it searches.
