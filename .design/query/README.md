# Cotail Query Design

This directory records the design evolution for cotail's session-selection,
content-search, evidence, and storage architecture.

Start with [`index.md`](/query/index.md). The current experiment compares typed
query builders against the synthesized baseline, then refines and independently
adjudicates the strongest proposal before implementation.

Current invariants:

- sessions are the stable result and deduplication unit;
- session metadata remains authoritative in opencode's live database;
- direct and indexed content search may use different matching and hit types;
- renderers depend on a shared structural search-result shape;
- content requirements have explicit witness boundaries and bounded
  `all`/`any`/`none` semantics;
- V1 `part` and V2 `session_message` are normalized per session;
- SQL and query-builder mechanics remain behind operation-shaped interfaces;
- implementation uses domain-decomposed workspace packages with explicit
  dependency direction.

Progress and handoffs are recorded in [`log.md`](/query/log.md).
