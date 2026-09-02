# Query Design Index

## Start Here

- [Draft4 intent audit](/.design/pushdown/intent-audit0.glm53.md)
  - Landing audit of the draft4 source-profile design: step and acceptance
  scorecards, review sharpening re-scored, and the intents that neither
  landed nor got a decision (capability consumers, certificates,
  `sources.json`, live measurement).
- [Live post-repair probe](/.design/pushdown/live-reprobe0.glm53.md)
  - Live 20.9 GB probe matrix after the operation repairs: metadata commands
  at ~1.1–1.5 s, plus the content-search JavaScript heap OOM and its
  validator-redundancy mechanism (`cotail-search-oom`).
- [Document-union validation redundancy probe](/.design/pushdown/materialization0.glm53.md)
  - Captured fixture evidence: the committed search SQL invokes the JS
  payload validator ~7× per in-range message; materialization and
  operation-owned variants measured as reference points.
- [Founding problem statement](/.design/pushdown/problem0.glm53.md)
  - Promoted from scratch: the measured 2026-08-29 report of silent exit 1
  and unindexed search over the live database that motivated the wave.
- [Pushdown after action](/.design/pushdown/after-action0.gpt56s.md)
  - Implementation-grounded account of what profiles and runtime cutover did,
    what remained physically broad, how `--since` is limited by current access
    paths, and the next history/search/storage/statement-construction wins.
- [Generated source profiles and demand-bounded queries](/.design/pushdown/draft4.gpt56s.md)
  - Active encompassing design: trusted generated OpenCode profiles, compact
    `opencode --version` compatibility contracts, explicit generation and
    validation, derived index capabilities, removal of hot-path Message-type
    scans, and operation-owned demand-bounded history/search plans.
- [Demand-bounded operation planning with certified access paths](/.design/pushdown/draft3.gpt56s.md)
  - Prior integrated pushdown design: candidate restriction, qualification and
    window frontiers, narrowest-identity downstream work, explicit cost
    envelopes, indexed/degraded source profiles, fail-closed plan conformance,
    and the accepted pinned history repair.
- [Demand-bounded operation planning](/.design/pushdown/draft2-syn.gpt56t.md)
  - Prior standalone synthesis grounded in current code and fixture evidence:
    candidate restriction, qualification and window frontiers, explicit cost
    envelopes, indexed access-path conformance, and the pinned history repair.
- [Qualification staging and bounded enrichment](/.design/pushdown/draft1.gpt56.md)
  - Prior pushdown draft: separates semantic stage order from physical
  boundedness, records that current history still scans the Message index, adopts
  operation-private Kysely stages plus conformance, and provides the repair plan.
- [Qualification pushdown contract and pinned-loop enrichment](/.design/pushdown/draft1.glm53.md)
  - Prior independent draft1 with executable evidence: tap-probe counts and
  plans for current, `IN`-seeded, cross-join-pinned, and correlated shapes; a
  Kysely-native `crossJoin` + `where` repair verified through the logical world;
  answers to draft0's scope questions and a sequenced forward plan.
- [Initial qualification pushdown brief](/.design/pushdown/draft0.gpt56.md) -
  Superseded handoff that identified the broad-aggregate class of failure and
  framed the qualify/order/window/hydrate problem.
- [`design3.gpt56.md`](/query/design3.gpt56.md) - Implemented V2 relational query
  direction: public logical Kysely relations, hierarchical identity, witnesses,
  evidence, grouped products, and Effect-owned execution.
- [Canonical session reporting and operation pass](/.design/session-report/full-query-pass0.gpt56.md)
  - Active breaking refinement of the operation-product layer: one Session
  report observation, explicit cardinality and pagination, shared machine-output
  specifications, compact usage presentation, and bounded child analysis.
- [Durable reference and bookmark design](/.design/bookmarks/draft5.gpt56.md) -
  Active persistence consumer of the query world. It reuses Target, Observation,
  evidence, and SessionReport while owning source relocation, bookmark intent,
  typed captures, local persistence, and live resolution.
- [Standalone query execution](/.design/query2/design2.gpt56.md) - Active
  `node:sqlite` direction: scoped reads, truthful provenance, stable snapshots,
  conventional Effect streaming, explain diagnostics, and direct migration.
- [Original execution contract](/.design/query2/design.md) - Broader
  standalone/hosted proposal retained as design lineage and alternatives.
- [`prompt1.gpt56.md`](/query/prompt1.gpt56.md) - Active design brief: V2-only,
  Kysely-forward shared library, Effect composition, multiple result grains, and
  an open identity/address-model challenge.
- [`README.md`](/query/README.md) - Concise scope and navigation.

## Prior Design Candidate

- [`design3-self.md`](/query/design3-self.md) - Direct answer to the active
  prompt preceding the implemented `design3.gpt56.md`: public Kysely logical
  relations, Effect services, V2-only storage, hierarchical Addresses,
  observations/evidence, multiple result grains, and per-Session windows.

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
