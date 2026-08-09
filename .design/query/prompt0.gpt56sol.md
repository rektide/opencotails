---
type: Prompt
title: Cotail query architecture design prompt
description: Open-ended prompt for designing a first-class query model across session metadata, content, evidence, and storage backends.
resource: /query/prompt0.gpt56sol.md
tags: [cotail, query, search, architecture, sqlite, fts]
status: draft
generated: { by: model:openai/gpt-5.6-sol, at: 2026-08-09T23:57:39Z }
sources:
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

# Cotail Query Architecture Design Prompt

## Situation

Cotail searches and reports on opencode sessions stored in SQLite. Its current direct search is useful, but query behavior has accumulated in several places:

- `search --title-only` builds SQL inside the command.
- content search builds correlated `EXISTS` queries through V1/V2 source adapters.
- `history` independently implements time and directory filtering plus message-count aggregation.
- recently added `--since` and `--directory` filters introduced the idea tentatively called `SessionSelection`: metadata criteria that winnow sessions before expensive content matching.
- the planned FTS phase will search a cotail-owned index with materially different matching, ranking, snippet, and indexing behavior.

`SessionSelection` is clearer than the earlier name `SessionScope`, but it exposes an architectural asymmetry. Session metadata criteria are beginning to become programmable and reusable, while content matching, the headline feature, remains largely bespoke control flow and SQL generation.

There may be a broader query architecture waiting to emerge. We want to investigate it without assuming in advance that the answer must be a generic query language, a SQL abstraction, or one interface shared by every command and backend.

## Problem

Design a coherent query architecture for cotail.

Consider whether session metadata, titles, content parts, message roles, related evidence such as snippets, ordering, limits, and aggregates should become first-class pieces of one query model. If they should not all share one model, identify the correct seams and explain why.

The design should account for the fact that criteria range over different things:

- session criteria range over one session row;
- title criteria also range over the session row;
- content criteria range over many related parts or events;
- role may range over related message metadata rather than content itself;
- snippets are evidence or projection, not necessarily filtering criteria;
- history counts are aggregates, not ordinary session fields;
- direct regex search and FTS `MATCH` do not necessarily have equivalent semantics.

The current term semantics deserve special attention. Multiple patterns are ANDed at the session level by generating one independent `EXISTS` subquery per pattern. Different patterns may match different content parts. The first snippet is currently drawn from the first content part matching the first pattern. These behaviors are easy to mistake for implementation details but may already be user-visible semantics.

## Design Freedom

Explore the problem rather than merely formalizing the current implementation. It is acceptable to recommend:

- one structured query model;
- several operation-specific query models sharing a smaller selection vocabulary;
- a typed criterion model grouped by the relation each criterion ranges over;
- a logical-query and execution-plan split;
- another architecture that better fits the domain.

Avoid assuming that every present behavior must be preserved if a clearer semantic model would be better. Identify behavior changes explicitly and explain their consequences.

Likewise, avoid adding generality only because it is possible. Cotail is below 1.0, but the architecture should remain a deep module with a small interface rather than exposing a miniature SQL engine to callers.

## Questions To Explore

1. What is the root domain object being queried: sessions, session history, content, or something else?
2. Is `SessionSelection` a reusable value inside several operations, or should content requirements also participate in selecting sessions?
3. Should title and content matching be variants of one match concept, or criteria over different relations?
4. How should the model express quantification over related content?
5. Does every pattern require a separate matching part to exist, or should some forms require one part to satisfy several conditions?
6. How should AND, OR, negation, exact phrases, and future role constraints enter the model without creating a generic predicate AST prematurely?
7. Is a snippet best modeled as projection, evidence, highlighting, or a property of the matching backend?
8. What should be shared by `search`, `history`, index selection, transcript reading, and future commands?
9. Where should direct V1/V2 storage differences live?
10. What, if anything, should direct search and future FTS share beyond session selection and normalized results?
11. How should unsupported backend semantics be represented: rejection, capability negotiation, fallback, or separate query forms?
12. What is the appropriate compiler or planner seam for predicate pushdown?
13. Should the compiled artifact be named or exposed, or remain an internal `{ sql, bindings }` detail?
14. How can the interface make behavioral testing natural without asserting exact SQL strings or query plans?
15. What incremental migration avoids a broad rewrite and keeps every step behaviorally verifiable?

## Suggested Success Criteria

These are guidance, not fixed constraints. A strong design will likely:

- make the semantics of session and content criteria explicit;
- clarify where `SessionSelection` fits and why it is named that way;
- make the headline content-search behavior first-class rather than leaving it embedded in command code;
- distinguish criteria from projection/evidence, ordering, limits, and aggregates;
- give callers a small interface while hiding V1/V2 SQL, parameter binding, source detection, deduplication, and query assembly;
- support adding session ID, project, updated ranges, and carefully researched content constraints without parallel edits across several SQL builders;
- preserve useful pushdown while being honest that unindexed source predicates may still scan sessions;
- avoid coupling the durable domain model to direct SQLite column names or FTS syntax;
- preserve room for FTS without pretending JavaScript regex and tokenized full-text search are equivalent;
- identify abstractions that should not be introduced yet;
- include example queries and their lowering into at least the current direct SQLite implementation;
- include a migration and testing strategy.

## Requested Deliverable

Produce a design document containing:

1. a concise domain model and vocabulary;
2. the proposed module interface and where its seam lives;
3. example TypeScript types, emphasizing semantics rather than final syntax;
4. direct-query compilation examples for session-only, title, and multi-pattern content queries;
5. treatment of snippets/evidence and history aggregates;
6. treatment of V1/V2 and future FTS implementations;
7. alternatives considered with their tradeoffs;
8. explicit unresolved decisions and experiments needed;
9. an incremental implementation sequence in small logical commits; and
10. examples showing how later `--project`, date-range, role, OR, and phrase features would or would not fit.

Prefer a design that concentrates complexity and gives callers leverage. Do not optimize for producing the most general type system.
