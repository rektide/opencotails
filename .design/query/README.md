# Cotail Query Design

This directory contains cotail's session-selection, content-search, evidence,
storage-authority, and future indexing design.

Start with [`design1.md`](/query/design1.md). It is the canonical working design:
what cotail query is building, settled semantics, implemented foundations, next
increments, acceptance criteria, and open product decisions.

Current normative support:

- [`authority0.md`](/query/authority0.md) is the source-backed V1/V2 storage
  authority decision.
- [`adjudication0.md`](/query/adjudication0.md) records the private Kysely,
  `node:sqlite`, package, and safety decision behind the implemented foundation.
- [`implementation2.md`](/query/implementation2.md) is the accepted production
  audit; it is evidence, not the forward build design.

Direct search, title search, history, and session resolution are implemented.
FTS/indexing, hydration, ranking/freshness, V2 tool/shell canonical text, and new
CLI boolean syntax remain unimplemented or undecided.

Use [`index.md`](/query/index.md) for progressive disclosure and
[`log.md`](/query/log.md) for dated changes.
