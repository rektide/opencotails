# Cotail Query Design

This directory records the design evolution for cotail's session-selection,
content-search, evidence, and storage architecture.

Start with [`index.md`](/query/index.md). Kysely was selected and the initial
query migration is complete. See [`implementation2.md`](/query/implementation2.md)
for the accepted implementation tip and final audit, and
[`implementation1.md`](/query/implementation1.md) for owner-aware V2/history
semantics, fixtures, checks, and query plans;
[`implementation0.md`](/query/implementation0.md) records the earlier stop.

Current invariants:

- sessions are the stable result and deduplication unit;
- session metadata remains authoritative in opencode's live database;
- direct and indexed content search may use different matching and hit types;
- renderers depend on a shared structural search-result shape;
- content requirements have explicit witness boundaries and bounded
  `all`/`any`/`none` semantics;
- V1 `part` and V2 `session_message` are normalized per session;
- `session_v2` ownership selects V2 metadata/content/counts, including zero
  native rows, while only unowned legacy sessions fall back to V1;
- completed migration state is required before reading a mixed database;
- SQL and query-builder mechanics remain behind operation-shaped interfaces;
- implementation uses domain-decomposed workspace packages with explicit
  dependency direction.

Current limitations: direct scans remain unindexed, and V2 tool/shell search is
rejected until a canonical text representation is selected. FTS, indexing,
hydration, and new CLI boolean syntax remain deferred.

Progress and handoffs are recorded in [`log.md`](/query/log.md).
