# Cotail Query Design

This directory records the design evolution for cotail's session-selection,
content-search, evidence, and storage architecture.

Start with [`index.md`](/query/index.md). Kysely was selected and implemented
through V1 bounded-boolean search. See
[`implementation0.md`](/query/implementation0.md) for the package map, checks,
and the real transition-data stop condition blocking V2/history precedence.

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

Current limitation: V2 normalization and history count replacement are not
implemented. Real transition rows do not yet prove a reliable per-session
content/count authority rule; preserving that uncertainty is required by the
adjudication.

Progress and handoffs are recorded in [`log.md`](/query/log.md).
