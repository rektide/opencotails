# Query Design Index

## Orientation

- [`README.md`](/query/README.md) - Current invariants and how to navigate this
  design area.
- [`log.md`](/query/log.md) - Chronological journal of design, review,
  adjudication, and implementation handoffs.
- [`packet-query-builders0.md`](/query/packet-query-builders0.md) - Canonical
  evidence and constraints for the Kysely/Drizzle comparison.

## Baseline

- [`prompt0.gpt56sol.md`](/query/prompt0.gpt56sol.md) - Original open-ended
  query-architecture prompt.
- [`draft1.syn.md`](/query/draft1.syn.md) - Broad synthesis of the initial
  alternatives and the baseline to improve upon.
- [`draft1.gpt56sol.md`](/query/draft1.gpt56sol.md) - Independent operation-shaped
  synthesis with the strongest mixed-layout and contract corrections.

## Initial Alternatives

- [`draft0.gpt56sol.md`](/query/draft0.gpt56sol.md) - Typed session-query
  envelope.
- [`design-alt0.ds4f.md`](/query/design-alt0.ds4f.md) - Match-first architecture
  with relation-tagged constraints and an explicit plan.
- [`design-alt0.glm52.md`](/query/design-alt0.glm52.md) - Selection spine and the
  key separation of live metadata from content-search engines.
- [`design-alt0.gpt56sol.md`](/query/design-alt0.gpt56sol.md) - Operation-shaped
  requests and nested witness requirements.

## Query Builder Wave

Artifacts are added here in order:

- [`draft-ksyley0.md`](/query/draft-ksyley0.md) - Executable Kysely 0.29.x
  proposal with a proven select-only `node:sqlite` adapter, package-enforced live
  metadata authority, and mixed V1/V2 normalization.
- [`draft-drizzle0.md`](/query/draft-drizzle0.md) - Executable Drizzle
  counterproposal: stronger schema-centered and synchronous ergonomics, but only
  conditionally viable through a costed `better-sqlite3` driver swap.
- [`draft-ksyley1.md`](/query/draft-ksyley1.md) - Refined Kysely architecture
  after direct Drizzle cross-review: smaller package graph, explicit async and
  close ownership, selected domain-shaped rows, and Kysely-owned index queries
  with narrow SQL migrations.
- [`adjudication0.md`](/query/adjudication0.md) - Selects refined Kysely over the
  baseline and Drizzle, records weighted evidence and hidden gaps, and provides a
  narrowed agent-ready implementation brief with runtime and semantic stop gates.
- [`implementation0.md`](/query/implementation0.md) - Records the implemented
  three-package workspace and V1 bounded query migration, plus the real-data
  authority mismatch that stopped V2/history migration before unsafe precedence.
