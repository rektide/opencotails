---
type: Report
title: Live post-repair probe and content-search OOM
description: Timed matrix of cotail commands against the live 20.9 GB OpenCode database after the history repair, title fast path, and tail/watch work; records a JavaScript heap OOM that makes content search unusable at weekly windows and identifies redundant in-process payload validation as the cause.
resource: /.design/pushdown/live-reprobe0.glm53.md
tags: [cotail, pushdown, live-probe, search, oom, validation, performance]
status: draft
generated: { by: model:zai/glm-5.3-max, at: 2026-09-02T00:00:00Z }
stale_after: 2026-10-02
sources:
  - id: prior-baseline
    resource: /.test-agent/profile-live/README.md
    title: Pre-repair live baseline (2026-09-01)
  - id: materialization-probe
    resource: /.design/pushdown/materialization0.glm53.md
    title: Fixture measurement of redundant payload validation
  - id: validator
    resource: /packages/query-kysely/src/source/validation.ts
    title: JS-registered payload validator
  - id: runtime-functions
    resource: /packages/query-kysely/src/runtime/node-sqlite.ts
    title: SQLite custom function registration
---

# Live Post-Repair Probe And Content-Search OOM

## What Is Up

The [after-action](/.design/pushdown/after-action0.gpt56s.md) left one
sequence obligation open: re-run the live probes after the operation repairs.
This report does that, against
`~/.local/share/opencode/opencode-local.db` (20.9 GB, 7,319 sessions, 361,561
messages), using a freshly generated profile at the conventional XDG path —
which is also the first time this machine has had a default-profile install
at all. Generation took 4.2 s (down from 7.1 s in the prior probe).

The metadata half of the matrix is a clean sweep. The content-search half
found a crash.

## Probe Matrix

All commands run from the repo checkout via `pnpm exec cotail`, wall clock,
JSON output discarded:

| Command | Pre-repair (2026-09-01) | Now | Status |
|---|---|---|---|
| `history --since 24h --limit 1 --json` | 7.4 s pre-cutover / 12.8 s post-cutover | **1.5 s** | repaired |
| `search --title-only cotail --limit 5 --json` | >30 s timeout | **1.2 s** | repaired |
| `tail --since 24h --limit 10 --json` | n/a (new) | **1.1 s** | good |
| `watch --once --since 1h --json` | n/a (new) | **1.1 s** | good |
| `search sqlite --since 7d --limit 5 --json` | not measured | **fatal: JS heap OOM at 4 GB** | broken |
| same with `--no-snippet` | not measured | **fatal: JS heap OOM** | broken |
| `search sqlite --limit 5 --json` (unbounded) | not measured | fatal: JS heap OOM (~70 s in) | broken |

The ~1.1–1.5 s figures are dominated by Node startup, pnpm, and profile
decode; the queries themselves are no longer the bottleneck anywhere in the
metadata class. The selected-root `CROSS JOIN` repair and the root-local
title path deliver on the live database exactly what the indexed fixtures
promised.

## The Content-Search Crash

The failing runs terminate with:

```text
FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory
node::sqlite::StatementSync::All
```

Mechanism, assembled from the fixture probe in
[materialization0](/.design/pushdown/materialization0.glm53.md) and the
runtime source:

1. `cotail_validate_message` is a **JavaScript-registered SQLite function**
   ([`node-sqlite.ts:92`](/packages/query-kysely/src/runtime/node-sqlite.ts))
   that `JSON.parse`s the entire message payload
   ([`validation.ts:291`](/packages/query-kysely/src/source/validation.ts))
   and strictly validates it. Every call materializes a ~27 KB string plus
   its parse tree in the V8 heap.
2. The [`cotail_document`](/packages/query-kysely/src/relations/world.ts)
   union reads `cotail_validated_message`, and its ~seven branches each
   inline that CTE: the committed SQL invokes the validator **7× per
   in-range message** (1,680 calls for 240 messages in the fixture probe).
3. A 7-day window on the live database is on the order of 40,000 messages.
   40,000 × 7 × 27 KB of string-and-parse-tree churn exhausts the default
   4 GB heap before qualification finishes. Unbounded search over 361,561
   messages cannot fit by construction.
4. `--no-snippet` does not help, because evidence-off omits *hydration*
   (the `hydrated_hits` stage) but the document union — and therefore the
   inner validation — still executes for witness qualification.

## What This Means

- The pushdown *staging* worked: candidate restriction, qualification,
  windowing, and hydration placement are all correct, and the fixture-scale
  measurements were honest. What the fixtures could not surface is that the
  cost model of a JS-registered function inside a multi-branch CTE union is
  multiplicative in both window size and union width.
- Strict per-message validation during witness qualification is a policy
  choice, not a requirement. The document branches already carry SQL-native
  `json_type` shape guards; the JS validator's strictness only needs to run
  on **selected hits** — which `hydrated_hits` already does independently.
  Moving inner validation out of the witness path should take live content
  search from "OOM" to "pays only SQL-native JSON expansion of the window."
- This is the concrete tracer for the [intent audit's](/.design/pushdown/intent-audit0.glm53.md)
  recommendation 3: the operation conformance suite asserted plan *shape*
   and validator-call *counts on tiny fixtures*; neither scaling dimension
  (window × payload size) was covered. A validator-call budget scaled to
  the requested window — or an explicit `--max-validate` style guard —
  would have caught this class before it shipped.

## Recommended Immediate Work

1. Stop invoking `cotail_validate_message` inside the witness/qualification
   path: build `cotail_document` from `cotail_scoped_message` plus the
   existing `json_type` guards, and keep strict validation only in
   `hydrated_hits` (selected hits). This matches the already-stated
   after-action intent that evidence-off SQL contain no payload work —
   which today it does not.
2. Re-probe content search live after that change; expected survivors are
   the SQL-native `json_each` expansion costs, which remain the honest
   residual until an FTS/policy decision.
3. Add a fixture test that counts validator calls per returned hit and
   fails when the ratio grows with union width or window size.

## Cross-References

- [Materialization probe capture](/.design/pushdown/materialization0.glm53.md)
  — fixture-scale measurement of the 7× validation redundancy and the
  variant comparison that predicts this crash.
- [After-action](/.design/pushdown/after-action0.gpt56s.md) — follow-up #4
  (re-run live probes) is closed by this report; follow-up #3's
  evidence-off omission claim needs revision in light of the OOM.
- [Prior baseline](/.test-agent/profile-live/README.md) — the 2026-09-01
  numbers this report supersedes.
- [Intent audit](/.design/pushdown/intent-audit0.glm53.md) — step-9
  measurement obligation, now half-closed (metadata yes, content no).
- [Search core draft](/.design/search/draft0.glm53.md) — Tier 1 field modes
  inherit whatever validation policy lands here; sequencing should put the
  OOM fix first.
