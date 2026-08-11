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
- Drizzle counterproposal informed by the Kysely proposal.
- Kysely refinement after reviewing Drizzle.
- Independent adjudication and implementation brief.
- Implementation report and verification evidence.
