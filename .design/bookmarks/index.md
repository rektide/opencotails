# Bookmark Design Index

## Active Direction

- [`draft5.gpt56.md`](/.design/bookmarks/draft5.gpt56.md) - Active replacement
  design. Bookmarks are durable intent over canonical query `Target`s with
  optional typed captures. Session reporting owns report capture; bookmarks own
  source relocation, persistence, resolution, and user-facing management.

## Superseded Lineage

- [`draft4.glm52.md`](/.design/bookmarks/draft4.glm52.md) - Final pre-query-world
  design. Its direct Session fields and lineage findings moved into
  `SessionReport` and logical lineage relations; its `Pointer`, `Composite`, V1
  capability detection, and command migration plan are superseded.
- [`draft3.glm52.md`](/.design/bookmarks/draft3.glm52.md) - Split direct Session
  data from derived lineage and preserved continuation/fork distinctions.
- [`draft2.glm52.md`](/.design/bookmarks/draft2.glm52.md) - Introduced the useful
  address-versus-description distinction but expressed it through the now
  superseded `Pointer` and `Composite` model.
- [`draft1.glm52.md`](/.design/bookmarks/draft1.glm52.md) - Explored a generic
  save-point domain. Its artifact ideas remain candidates, not bookmark kinds.
- [`draft0.glm52.md`](/.design/bookmarks/draft0.glm52.md) - Initial flat bookmark
  record and speculative TSV/Turso persistence design.

## Idea Inventory

- [`applications.glm52.md`](/.design/bookmarks/applications.glm52.md) - Future
  producer/consumer ideas. `draft5` reclassifies them into ordinary bookmarks,
  closures, handoffs, live lineage operations, or serializers instead of generic
  `Composite` producers.

## Related Designs

- [Canonical Session reporting](/.design/session-report/full-query-pass0.gpt56.md)
  supplies capture-ready Session observations.
- [V2 relational query world](/.design/query/design3.gpt56.md) supplies Address,
  Target, Observation, evidence, and stable operation products.
- [Scoped query execution](/.design/query2/design2.gpt56.md) supplies truthful
  same-read provenance, not durable source identity or revision.
