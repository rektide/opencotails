# Query Design Index

## Start Here

- [`prompt1.gpt56.md`](/query/prompt1.gpt56.md) - Active design brief: V2-only,
  Kysely-forward shared library, Effect composition, multiple result grains, and
  an open identity/address-model challenge.
- [`README.md`](/query/README.md) - Concise scope and navigation.

## Current Design Candidate

- [`design3-self.md`](/query/design3-self.md) - Direct answer to the active
  prompt: public Kysely logical relations, Effect services, V2-only storage,
  hierarchical Addresses, observations/evidence, multiple result grains, and
  per-Session windows.

## Active Research

- [`opencode-v2-model0.general.md`](/query/opencode-v2-model0.general.md) - Current
  OpenCode V2 source model, Effect architecture, integration seams, result
  grains, logical-schema inputs, and V1-removal research.
- [`.test-agent/query-kysely-selection/README.md`](/.test-agent/query-kysely-selection/README.md)
  - Executable scratch evidence for Kysely expression factories, query
  transforms, logical CTE relations, witnesses, and seeded query contexts.

## Unaccepted Candidate

- [`design2.md`](/query/design2.md) - Custom selector/qualification model produced
  before the Kysely-forward direction was established. Retained to challenge and
  mine, not recommended as the current design.

## Prior Cross-Assessment

- [`draft1.syn.md`](/query/draft1.syn.md) - The prior cross-assessment feeding
  `design2`: consensus on session roots, operation-shaped requests, bounded
  witnesses, private lowering, and honest backend separation, plus provisional
  conclusions sharpened by the latest design.
- [`draft1.gpt56sol.md`](/query/draft1.gpt56sol.md) - Strongest operation-shaped
  refinement before `design2`; superseded as the recommendation but useful for
  the narrow selector and nested witness model.

## Prior Decisions And Constraints

- [`authority0.md`](/query/authority0.md) - Normative mixed-storage authority:
  `session_v2` ownership, completed migration state, zero-row authority, no
  residue union, canonical content, and counts.
- [`adjudication0.md`](/query/adjudication0.md) - Normative foundation decision:
  private Kysely over `node:sqlite`, package direction, compatibility, runtime,
  lifecycle, and semantic gates. Its private-Kysely conclusion is reopened by the
  active prompt.
- [`packet-query-builders0.md`](/query/packet-query-builders0.md) - Constraint and
  evaluation packet; still useful as a review checklist, not a build plan.

## Implemented Reality

- [`implementation2.md`](/query/implementation2.md) - Accepted production audit
  and final Node 22/26 evidence.
- [`implementation1.md`](/query/implementation1.md) - Detailed owner-aware
  completion, compatibility, fixtures, and query-plan evidence.
- [`implementation4.md`](/query/implementation4.md) - Broad implementation
  comparison and lineage map; evidentiary, not current design guidance.
- [`implementation0.md`](/query/implementation0.md) - Superseded partial V1
  implementation and justified authority stop.

## Architecture Lineage

- [`draft-ksyley1.md`](/query/draft-ksyley1.md) - Superseded refined package/API
  proposal; useful for prospective candidate hydration and lifecycle seams.
- [`draft-ksyley0.md`](/query/draft-ksyley0.md) - Initial executable Kysely
  alternative; experiment/reference only.
- [`draft-drizzle0.md`](/query/draft-drizzle0.md) - Executable Drizzle
  counterproposal; rejected under the built-in-runtime constraint.
- [`draft0.gpt56sol.md`](/query/draft0.gpt56sol.md) - Initial typed query envelope;
  superseded.
- [`design-alt0.ds4f.md`](/query/design-alt0.ds4f.md) - Match-first/exported-plan
  alternative; not selected.
- [`design-alt0.glm52.md`](/query/design-alt0.glm52.md) - Selection-spine and live
  metadata authority alternative; key ideas incorporated.
- [`design-alt0.gpt56sol.md`](/query/design-alt0.gpt56sol.md) - Operation-shaped,
  nested-witness alternative; key ideas incorporated.
- [`prompt0.gpt56sol.md`](/query/prompt0.gpt56sol.md) - Original exploration
  prompt and foundational statement of the selector/relation/witness problem.

## Failed And Deprecated

- [`design1.md`](/query/design1.md) - Failed, off-target synthesis. It centered
  implementation status and an FTS roadmap instead of the selector/scope
  object-model objective. Retained for transparent lineage only.

## Journal

- [`log.md`](/query/log.md) - Dated design, decision, and implementation handoffs.
