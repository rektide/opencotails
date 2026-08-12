# Query Design Index

## Start Here

- [`design1.md`](/query/design1.md) - Canonical working design and recommended
  entry point: objective, semantics, architecture, current state, next build
  sequence, acceptance criteria, and open decisions.
- [`README.md`](/query/README.md) - Concise scope and navigation.

## Current Normative Decisions

- [`authority0.md`](/query/authority0.md) - Normative mixed-storage authority:
  `session_v2` ownership, completed migration state, zero-row authority, no
  residue union, canonical content, and counts.
- [`adjudication0.md`](/query/adjudication0.md) - Normative foundation decision:
  private Kysely over `node:sqlite`, package direction, compatibility, runtime,
  lifecycle, and semantic gates.
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

- [`draft1.syn.md`](/query/draft1.syn.md) - Superseded broad synthesis; source of
  session-root, bounded-witness, and direct/index separation ideas.
- [`draft1.gpt56sol.md`](/query/draft1.gpt56sol.md) - Superseded operation-shaped
  synthesis; useful for domain vocabulary and intended FTS distinction.
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
  prompt; historical context only.

## Journal

- [`log.md`](/query/log.md) - Dated design, decision, and implementation handoffs.
