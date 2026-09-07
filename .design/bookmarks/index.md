# Bookmark Design Index

## Current Proposal And Baseline

- [`implementation0.gpt6a.md`](/.design/bookmarks/implementation0.gpt6a.md) - Parent
  reading order and checkpoint brief for the next exact-bookmark/link capability
  after GX read-only review fixes. Maps the live P1 tickets, superseded guidance,
  durable-source gap and fixture acceptance; not authorization of the whole epic.

- [`callable-read0.gpt6a.md`](/.design/bookmarks/callable-read0.gpt6a.md) - First
  authorized runtime slice: shared bounded Session read plus public tool/RPC.
  Records isolated-host error/cancellation/unload evidence, dependency versions,
  passing tests, GX review/parent acceptance and the remaining source-binding
  gate. Not live-installed.

- [`runtime-probe0.gpt6a.md`](/.design/bookmarks/runtime-probe0.gpt6a.md) - Actual
  production fixture execution: 12/12 cases pass on Node 26.6.0 and Bun 1.4.1,
  including a two-Effect-version Promise/JSON boundary. Revises the speculative
  Node-helper recommendation toward a direct in-process first read tool/RPC.
  This historical prerequisite is followed by the callable-read implementation
  above; it does not prove successful co-located writer concurrency.

- [`links-tools0.gpt6a.md`](/.design/bookmarks/links-tools0.gpt6a.md) - New human
  priority: definitive cross-session links as bookmark k=v Target values, plus
  P1 callable read operations and exact bookmark/link tools sharing public read
  RPC with UI consumers. No separate graph store, global namespace prerequisite,
  or dependency on deferred next-response binding. Design remains unaccepted.

- [`summary0.gpt6a.md`](/.design/bookmarks/summary0.gpt6a.md) - Unaccepted
  extension for explicitly marked summaries, historical/child Message targets,
  pending next-response intent, and selectable `rektide_cotail_*` SQLite storage
  defaulting to the selected OpenCode source DB. Verifies channel/profile limits
  and preserves ordinary read-only queries. Linked to Rekon's
  `rekon-session-mementos` client-scoped epilogue work; no runtime implementation.

- [`draft5.gpt56.md`](/.design/bookmarks/draft5.gpt56.md) - Foundational replacement
  design. Bookmarks are durable intent over canonical query `Target`s with
  optional typed captures. Session reporting owns report capture; bookmarks own
  source relocation, persistence, resolution, and user-facing management.
  Its XDG-sidecar-only storage restriction is superseded by the current human
  selected/default-colocated DB intent; exact implementation choices remain
  unaccepted. Its argument is preserved as lineage rather than overwritten.

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

- [Rekon session-mementos brief](file:///home/rektide/src/rekon/design/session-mementos/brief0.gpt6a.md)
  is the cross-project anchor: ordered this-window/client selection and Session
  lookers belong to the epilogue; Cotail supplies durable summary retrieval.
- [Canonical Session reporting](/.design/session-report/full-query-pass0.gpt56.md)
  supplies capture-ready Session observations.
- [V2 relational query world](/.design/query/design3.gpt56.md) supplies Address,
  Target, Observation, evidence, and stable operation products.
- [Scoped query execution](/.design/query2/design2.gpt56.md) supplies truthful
  same-read provenance, not durable source identity or revision.
