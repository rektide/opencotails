---
type: ImplementationReport
title: Cotail standalone query execution implementation
description: Implementation record for the scoped node:sqlite query architecture.
resource: /.design/query2/implementation.gpt56.md
tags: [cotail, query, execution, effect, sqlite, streaming]
status: draft
generated: { by: model:openai/gpt-5.6, at: 2026-08-20T00:00:00Z }
stale_after: 2026-11-20
sources:
  - id: scoped-query-design
    resource: /.design/query2/design2.gpt56.md
    title: Cotail standalone query execution
---

# Cotail Standalone Query Execution Implementation

## Scope

This report tracks implementation of Cuts 1 and 2 from the
[standalone query execution design](/.design/query2/design2.gpt56.md): a scoped
read transaction, truthful read provenance, buffered and explained queries,
lazy streaming, direct caller migration, and behavioral tests. Operational
polish remains outside the implementation unless needed to verify the resource
model.

Tracked work: `cotail-query-read-scope`.

## Baseline

Before implementation, the repository passed:

- 13 root CLI integration tests;
- 46 `@opencoattails/query-kysely` tests;
- 6 `@opencoattails/query-runtime` tests; and
- TypeScript checks for both packages.

The working copy began empty at commit `a4ba1765` (`Clarify closed read scope
failure`).

## Implementation Log

Implementation is in progress.

## Design Conformance

Conformance and deviations will be recorded after each implementation cut.

## Verification

Final verification results will be recorded here.

## Cross-References

- [The standalone query execution design](/.design/query2/design2.gpt56.md)
  defines the target contracts, lifecycle semantics, and required behavioral
  suite.
- [The original execution contract](/.design/query2/design.md) is the broader
  provider-oriented design superseded for this implementation.
- [The V2 relational query world](/.design/query/design3.gpt56.md) defines the
  logical relations consumed by the execution module.
