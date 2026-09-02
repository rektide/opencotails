---
type: Review
title: Draft4 intent versus landing audit
description: Step-by-step and acceptance-criteria audit of the draft4 source-profile design against the implementation as of the tail/watch run, including the review's sharpening items and the intents that never landed or were deliberately superseded.
resource: /.design/pushdown/intent-audit0.glm53.md
tags: [cotail, pushdown, source-profile, audit, capabilities, certificates, search, tail]
status: draft
generated: { by: model:zai/glm-5.3-max, at: 2026-09-02T00:00:00Z }
stale_after: 2026-12-02
sources:
  - id: draft4
    resource: /.design/pushdown/draft4.gpt56s.md
    title: Generated source profiles and demand-bounded queries
  - id: draft4-review
    resource: /.design/pushdown/draft4-review.gpt56s.md
    title: Draft4 review
  - id: after-action
    resource: /.design/pushdown/after-action0.gpt56s.md
    title: Pushdown after action
  - id: capabilities
    resource: /packages/query-kysely/src/profile/capabilities.ts
    title: Capability derivation and requirement registry
  - id: direct-search
    resource: /packages/query-kysely/src/operations/direct-search.ts
    title: Staged direct-search operation
  - id: runtime
    resource: /src/profile/runtime.ts
    title: Trusted runtime profile resolution
---

# Draft4 Intent Versus Landing Audit

## What Is Up

Draft4 and its review predate the last two days of work (history repair,
bounded search, title fast path, tail, watch). This audit re-asks their
question now: did the implementation extract the **full design intent**, and
where it did not, was that a deliberate decision or a dropped thread? The
method is direct: walk draft4's Implementation Sequence and Acceptance lists
item by item against the current code, then re-score the review's Sharpening
and Optimization Menu items, and finally name the intents that neither landed
nor received a decision.

## Implementation Sequence Scorecard

| # | Draft4 step | Status | Evidence |
|---|---|---|---|
| 1 | `cotail.source-profile/v1` format: version allowlist, schema/index facts, variant sets, capabilities, certificates field | **Landed** | [`codec.ts`](/packages/query-kysely/src/profile/codec.ts), [`types.ts`](/packages/query-kysely/src/profile/types.ts); certificates field decodes (contract pinned to 1) |
| 2 | Profile resolution + async `opencode --version` check + `--trust-profile` override | **Superseded deliberately** | [`runtime.ts`](/src/profile/runtime.ts) trusts the file unconditionally; no `--trust-profile` exists anywhere in `src/`; the [after-action](/.design/pushdown/after-action0.gpt56s.md) records this as an explicit supersession of draft4 text |
| 3 | `profile generate` extracting schema, indexes, Message variants, operation plans into deterministic JSON | **Landed except plans** | [`extract.ts`](/packages/query-kysely/src/profile/extract.ts), [`generate.ts`](/src/profile/generate.ts); plan extraction never implemented (nothing produces certificates) |
| 4 | Selective `profile validate` and atomic `profile refresh` | **Landed** | [`validate.ts`](/src/profile/validate.ts), [`commands/profile/`](/src/commands/profile/index.ts) |
| 5 | Runtime acquisition from profile facts; remove `SELECT DISTINCT type` | **Landed** | [`runtime.ts`](/src/profile/runtime.ts); acquisition tests prove no schema/type inspection |
| 6 | Bundled/reference profile + indexed fixture from one canonical version | **Landed as fixture pair** | [`fixtures/opencode-v2/`](/packages/query-kysely/test/fixtures/opencode-v2/source.ts) with generated [`profile.ts`](/packages/query-kysely/test/fixtures/opencode-v2/profile.ts); no bundled *user-facing* profile ships (reasonable for a local CLI) |
| 7 | History conformance + selected-root `CROSS JOIN` aggregate | **Landed** | [`history.ts`](/packages/query-kysely/src/operations/history.ts); plan tests require `SEARCH session_message (session_id=?)` and reject Message scans |
| 8 | Direct-search audit: candidate restriction, selected-hit hydration, evidence-off omission | **Landed** | [`direct-search.ts`](/packages/query-kysely/src/operations/direct-search.ts) stages `candidate_sessions` → `witness_qualified_sessions` → `selected_sessions` → `matching_documents` → `ranked_documents` → `selected_hits` → evidence-only `hydrated_hits` |
| 9 | Measure remaining costs before proposing further machinery | **Half-landed** | Pre-repair live probes recorded (12.8 s one-row history, >30 s title search); **no post-repair live re-probe exists** — all subsequent verification is indexed-fixture based |

Verdict: **eight of nine steps substantially landed, one deliberate
supersession, one unfinished measurement obligation.** The supersession
(step 2) is defensible — the spawn cost ~1.1 s per command and the
trusted-cache failure model already accepts natural stale-profile failures —
but draft4's own text still prescribes the version check as *normal
execution*, and nothing in draft4 marks that section superseded. The
after-action carries the record; the design doc does not.

## Acceptance Criteria Scorecard

| Draft4 acceptance clause | Status |
|---|---|
| No schema/index/migration/type-discovery/plan queries on normal commands | Landed, test-enforced |
| Compact version contracts, not migration lists | Landed |
| "`opencode --version` is checked before profile use, with an explicit trust override" | **Not landed — superseded** (see above) |
| Generation and validation are explicit user actions | Landed |
| Supported vs observed variant distinction | Landed |
| Index requirements derived by SQLite key semantics, not names | Landed — [`capabilities.ts`](/packages/query-kysely/src/profile/capabilities.ts) implements leftmost-prefix, collation, direction, partial-index rejection |
| No persistent user-data indexes | Landed (read-only, `query_only`) |
| "History is root-driven **and indexed according to its profile capability**" | **Half-landed** — root-driven yes; but the capability record is *recorded, not consulted*: conformance comes from fixture plan tests, and no runtime code reads `capabilities` |
| Direct search retains witness semantics while deferring hydration | Landed |
| Five residual costs tracked honestly | Landed — the after-action restates them and adds the snapshot-pin question |

## Review Sharpening Items, Re-Scored

The [review](/.design/pushdown/draft4-review.gpt56s.md) asked for three
sharpenings. As of this audit:

1. **Extend the capability DSL with `range` (+ covering): not done.**
   [`SOURCE_PROFILE_INDEX_REQUIREMENTS`](/packages/query-kysely/src/profile/capabilities.ts)
   still registers exactly two requirements (`history.message_owner_lookup`,
   `message.timeline`); the operator union is still only `equality` + order.
   The irony sharpened: `cotail tail` now *depends* on
   `session_message(time_created)` range access, and proves it with plan
   tests — the access path the DSL cannot express is now load-bearing
   product behavior.
2. **Land or drop certificates: not done, still inert.** `validate --plans`
   still prints "recorded certificates are unsupported"
   ([`validate.ts:94`](/src/profile/validate.ts)). No code path produces a
   certificate. The review's warning — a certificate nothing produces or
   checks rots into false confidence — now describes shipped v1 behavior.
3. **Decide the version-check policy: decided, as supersession.** The
   implementation and after-action chose trust-outright. This is the one
   sharpening resolved; it just was resolved by dropping the check rather
   than implementing it.

The review's Optimization Menu, re-scored:

| Menu item | Status |
|---|---|
| 1. Window-bounded direct search (`time_created` propagation) | **Landed** — `context.world({ messageCreatedRange })` + `--since`/`--since-updated` backfill bounding |
| 2. Global recent-activity product (`cotail tail`) | **Landed** — [`recent-message-activity.ts`](/packages/query-kysely/src/operations/recent-message-activity.ts) + `tail`/`watch` |
| 3. Message-activity membership for history | **Not landed** — history `--since` remains session-row semantics; the naming conflation stands; title-only search gained an activity gate but history did not gain a message-activity mode |
| 4. Certify the covering-index property | Not landed (subsumed by certificates, above) |
| 5. Feed queued tickets (`read-session`, `children`, `fileuse`) | Partial — window bounding exists for future consumers; the tickets remain open |
| 6. Relation-family seeding | Deferred, as the review itself recommended |

## Intents That Neither Landed Nor Got A Decision

These are the genuinely dropped threads — no code, no supersession record:

1. **`sources.json` and multi-profile resolution.** Draft4's storage section
   specifies a source catalog with per-source profile association and a
   five-step resolution order. Only the conventional XDG path + `--profile`
   landed. This intent is now nominally owned by
   `cotail-bookmarks-source-catalog` in beads, but draft4's text reads as if
   it shipped. The practical cost is already visible: the default DB hint
   resolves to the wrong file on the author's machine (`opencode.db` vs
   `opencode-local.db`).
2. **Degraded visibility for `unavailable` capabilities.** Draft3's
   three-outcome model (refuse / certified / degraded-visible) lost its
   third branch; the review called this out; nothing surfaces
   `unavailable` to users. With only two registered requirements the
   blast radius is small, which is exactly why deciding now is cheap.
3. **Operations consuming capabilities.** Draft4's module architecture says
   operation code consumes decoded capabilities "through the existing query
   context." The plumbing passes them
   ([`runtime.ts:63`](/src/profile/runtime.ts)), and nothing reads them.
   Every landed performance guarantee came from plan tests instead. Either
   the DSL grows consumers or the capability layer should shrink to what it
   truly is today: generation-time documentation.
4. **Post-repair live measurement (sequence step 9).** The after-action's
   follow-up #4 ("re-run live probes") is the only sequence obligation left
   open, and it gates every honest performance claim made since.

## Judgment

The landing is faithful where it matters most: the trusted-cache boundary,
the demand-bounded operation shapes, and the conformance discipline all
exist and are enforced by tests rather than convention. The deviations
cluster in one place — **the capability/certificate vocabulary was built as
form and has not yet acquired function.** That is a survivable state for a
young subsystem, but it is now the single widest gap between draft4's
written intent and reality, and it compounds: `tail` productized an index
the registry cannot name, and the next access-path work (parent lookup for
`cotail-children`, recency ranges, event tables) will keep bypassing it.

Recommended dispositions, in order:

1. **Amend draft4** with a short supersession note on the version-check and
   `sources.json` sections pointing at the after-action and this audit, so
   the design doc stops describing unshipped behavior as normal execution.
2. **Re-run the live probe matrix** against the repaired operations and
   record it; this closes sequence step 9 and converts fixture claims into
   measured ones.
3. **Decide the capability layer** with one concrete tracer: add the
   `range` operator, register `message.time_range`, and have the
   recent-activity operation (or its tests) consult it. If that feels
   heavier than its value, cut the `certificates` field from v1 and freeze
   the registry at documentation status — an explicit small scope is better
   than an implicit large one.

## Cross-References

- [Draft4](/.design/pushdown/draft4.gpt56s.md) — the audited design; its
  Remaining Cost Assessment remains accurate.
- [Draft4 review](/.design/pushdown/draft4-review.gpt56s.md) — prior
  drift assessment; its Sharpening items 1–2 remain open, item 3 resolved
  by supersession.
- [After-action](/.design/pushdown/after-action0.gpt56s.md) — records the
  trust-policy supersession and the follow-ups this audit re-scores.
- [Tail/watch exploration](/.design/watchman/tail-watch.gpt56s.md) — the
  product that now depends on the unexpressable `time_created` capability.
- [Development ideas](/.design/ideas/ideas.gpt56s.md) — idea #2 (source
  catalog) owns the `sources.json` intent draft4 left dangling; idea #7
  (plan certificates) owns the certificate decision.
