# Query Design Log

## 2026-09-01

- Added the [pushdown after-action report](/.design/pushdown/after-action0.gpt56s.md),
  separating the compatibility/startup wins of generated trusted profiles from
  operation-level demand pushdown. It records live lookup/history/search probes,
  the physically inverted pre-repair history plan, `--since`'s missing Session
  recency access path, the explicit-only validation policy, the read-scope
  snapshot-pin follow-up, and a measurement-driven map of further wins.

## 2026-08-30

- Added [generated source profiles and demand-bounded queries](/.design/pushdown/draft4.gpt56s.md),
  replacing hot-path schema/index/type discovery with trusted generated JSON,
  compact OpenCode version allowlists checked through `opencode --version`, and
  explicit profile generation/validation. The encompassing design retains
  candidate/qualification/window planning, accepts the root-driven history
  repair, scopes the direct-search rewrite, and distinguishes which remaining
  costs profiles or demand-bounded construction do and do not solve.

## 2026-08-29

- Added [demand-bounded operation planning with certified access paths](/.design/pushdown/draft3.gpt56s.md),
  integrating the pushdown wave around candidate restriction, separate
  qualification/window frontiers, narrowest-identity enrichment and hydration,
  source-profile-specific cost envelopes, and fail-closed physical certificates.
  It accepts the root-driven history aggregate, preserves current CLI limit
  semantics, incorporates measured logical-world predicate reach, and assigns a
  separate candidate/child-window/hydration audit to direct search.
- Added [demand-bounded operation planning](/.design/pushdown/draft2-syn.gpt56t.md),
  a standalone synthesis based on the current operations, logical world, source
  contract, and prior probe evidence. It defines candidate restriction plus
  qualification/window frontiers, operation-specific cost envelopes, indexed
  access-path conformance, a pinned history repair, and a separate direct-search
  audit. It also records why existing asymmetric `tap()` counts and wall-clock
  ratios are corroboration rather than correctness gates.

## 2026-08-21

- Added an independent parallel
  [pushdown draft1 (glm53)](/.design/pushdown/draft1.glm53.md) beside the
  gpt-5.6 draft1: fixture-verified plan evidence for the unbounded current
  history aggregate, a negative result for the `IN`-seeded repair, a
  Kysely-native `crossJoin` + `where` pin that restores indexed owner probes
  through the logical world, the qualification/enrichment/hydration contract,
  and a sequenced forward plan. The two draft1s await a synthesis pass.

## 2026-08-20

- Added [the standalone query execution design](/.design/query2/design2.gpt56.md),
  choosing `node:sqlite` over a hypothetical OpenCode host adapter, conventional
  Effect scope discipline over structural non-escape claims, permissive explain
  and local diagnostics, compiler-level readonly results, and direct breaking
  migration. The revision resolves, defers, removes, or evidence-gates every
  open decision from the original execution PRD.
- Updated query and runtime navigation to retain the broader
  [original execution contract](/.design/query2/design.md) as design lineage.

## 2026-08-17

- Added [the query execution contract PRD](/.design/query2/design.md), refining
  the implemented V2 query world with provider-owned read scopes, explicit read
  provenance, multi-statement consistency, scoped streaming, capability-honest
  interruption, structured failures, safe tracing, and provider conformance.
- Updated query navigation to distinguish the implemented
  [`design3.gpt56.md`](/query/design3.gpt56.md) direction from the earlier
  `design3-self` candidate.

## 2026-08-15

- Added [`design3-self.md`](/query/design3-self.md), a direct answer to the active
  prompt. It proposes a public Kysely query world over V2 logical relations,
  Effect-managed execution, hierarchical source Addresses, revision-aware
  observations, broad searchable documents, and multi-grain/per-Session results.
- Added [`prompt1.gpt56.md`](/query/prompt1.gpt56.md), the active brief for a
  V2-only, Kysely-forward, Effect-composed CLI and reusable library with multiple
  result grains and an intentionally open shared identity/address model. Demoted
  `design2` from recommendation to an unaccepted custom-model candidate.
- Added [`opencode-v2-model0.general.md`](/query/opencode-v2-model0.general.md), a
  source audit of OpenCode V2 terminology, Effect architecture, persistence,
  extension seams, result grains, per-Session limits, and V1-removal leverage.
- Added [`design2.md`](/query/design2.md) as the recommended selector and session-
  qualification object-model adjudication, recovering the prior `draft1` cross-
  assessment and sharpening title/content conjunction, witness scopes, stable
  evidence IDs, backend language boundaries, and the recursive-AST threshold.
- Deprecated [`design1.md`](/query/design1.md) as a failed, off-target synthesis
  because it centered implementation and FTS progression rather than the query
  scope/selector design objective; navigation now points to `design2` while
  preserving the failed document as lineage.

## 2026-08-14

- Added [`design1.md`](/query/design1.md) as the canonical one-stop working
  design, separating product intent, normative semantics, implemented reality,
  next capabilities, non-goals, and open index/CLI/content decisions.
- Refocused [`README.md`](/query/README.md) and [`index.md`](/query/index.md) so
  current guidance appears first and experiments, alternatives, implementation
  reports, and superseded baselines remain navigable as lineage or evidence.

## 2026-08-12

- Added [`implementation4.md`](/query/implementation4.md), a broad comparison of
  all materially different query implementations. It separates proposal/spike
  evidence from shipped evidence, explains why Kysely beat Drizzle under the
  `node:sqlite` constraint, traces the `session_v2` authority correction, and
  assesses the post-review hardened implementation against the adjudication.

## 2026-08-11

- Completed [`implementation2.md`](/query/implementation2.md), the final
  acceptance audit. It rejects partial owner layouts, closes native handles on
  failed opens, blocks writes through Kysely's actual adapter dispatch, restores
  the characterization fixture, and passes 21 live-store plus 8 root tests on
  both Node 22 and Node 26.
- Completed adjudication steps 8-10 under the stable owner decision.
  [`implementation1.md`](/query/implementation1.md) records owner-aware V2
  content, canonical history counts, the 17-case authority suite, byte-compatible
  CLI integration, Node 22 proof, real read-only commands, and non-regressing
  representative query plans.
- Removed the obsolete event fallback, source iteration, additive history
  reader, and old lookup reader after all consumers moved behind the private
  live-store operation interface. V2 tool/shell search remains rejected and
  FTS/index/hydration remain deferred.
- Added [`authority0.md`](/query/authority0.md) after auditing the current,
  byte-identical opencode migration/projector sources in both local archives and
  running aggregate-only analysis against the live database. The decision
  rejects ID union and message-presence precedence: completed `session_v2`
  ownership selects canonical `session_message` content/counts, while only a
  V1-owned session falls back to `message`/`part`. Steps 8-10 may resume under
  mandatory zero-row, omission, revert, incomplete-migration, and sequence-gap
  fixtures.
- Implemented the adjudicated workspace through bounded V1 search in seven
  commits. [`implementation0.md`](/query/implementation0.md) records package
  boundaries, commit IDs, checks, and divergences.
- Stopped before V2 normalization and history migration after read-only analysis
  of 5,254 real sessions found 1,222 legacy/all-native count mismatches and 395
  legacy/native-user-assistant mismatches. This activates the adjudication's
  transition-authority stop condition; no universal precedence was encoded.
- Added [`adjudication0.md`](/query/adjudication0.md), selecting refined Kysely
  over the baseline and Drizzle while narrowing initial implementation to domain,
  live-store, and test-contract packages. Both spikes were rerun byte-identically;
  minimum-Node read-only execution, real mixed-layout authority, complete bounded
  boolean lowering, and V2 array extraction remain mandatory gates.
- Added [`draft-ksyley1.md`](/query/draft-ksyley1.md), refining the Kysely design
  after reviewing Drizzle's successful fixture and criticisms. The refinement
  reduces the runtime graph, narrows the async facade, makes native connection
  ownership explicit, uses domain-shaped Kysely selections, and assigns Kysely
  private index queries while keeping migrations as narrow cotail-owned SQL.
- Added [`draft-drizzle0.md`](/query/draft-drizzle0.md). The supported
  `better-sqlite3` spike passed the representative mixed-layout query, while a
  custom `node:sqlite` session was rejected for internal Drizzle API coupling;
  native-addon installation and exact-version publication remain decisive costs.
- Added [`draft-ksyley0.md`](/query/draft-ksyley0.md), the initial executable
  Kysely alternative, and verified its isolated `node:sqlite` fixture and strict
  type check with byte-identical generated SQL/results.
- Started the typed query-builder wave under epic `cotail-query-builder`.
- Established [`packet-query-builders0.md`](/query/packet-query-builders0.md) as
  the shared handoff packet for Kysely, Drizzle, refinement, adjudication, and
  implementation agents.
- Added bounded `all`/`any`/`none`, live opencode metadata authority, a shared
  renderer-facing `SearchResult`, and domain-decomposed workspace packages as
  explicit design constraints.
- Confirmed the local source archives at `/home/rektide/archive/kysely-org/kysely`
  and `/home/rektide/archive/drizzle-team/drizzle-orm`. Kysely exposes a small
  `better-sqlite3`-shaped dialect interface; Drizzle's archived source has no
  native `node:sqlite` driver. Both proposals must resolve this rather than
  assuming compatibility.

## 2026-08-10

- Produced [`draft1.gpt56sol.md`](/query/draft1.gpt56sol.md), including the
  per-session V1/V2 normalization correction.
- Produced [`draft1.syn.md`](/query/draft1.syn.md), synthesizing the independent
  `design-alt0` wave.
