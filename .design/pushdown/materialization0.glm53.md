---
type: Report
title: Document-union validation redundancy probe
description: Captured results of the message-range materialization experiment measuring payload-validator calls, elapsed time, and plan shape for the committed bounded direct-search SQL versus three rewrite variants on a production-indexed fixture.
resource: /.design/pushdown/materialization0.glm53.md
tags: [cotail, pushdown, search, cte, materialization, validation, fixture, probe]
status: draft
generated: { by: model:zai/glm-5.3-max, at: 2026-09-02T00:00:00Z }
stale_after: 2026-12-02
sources:
  - id: original-probe
    resource: /.test-agent/message-range-materialization/probe.ts
    title: Probe script (2026-09-01, agent investigation)
  - id: captured-results
    resource: /.test-agent/message-range-materialization/results.txt
    title: Captured probe output (2026-09-02 re-run)
  - id: live-oom
    resource: /.design/pushdown/live-reprobe0.glm53.md
    title: Live-database OOM this probe predicts
---

# Document-Union Validation Redundancy Probe

## What Is Up

The newest scratch probe in `.test-agent/message-range-materialization/`
was written against the bounded direct-search commits and never captured a
results file or earned a design citation. This document promotes its
evidence before it goes stale: the probe was re-run on 2026-09-02 against
the current tree, the full JSON output is preserved at
`.test-agent/message-range-materialization/results.txt`, and its finding
turned out to be the mechanism behind the live content-search OOM recorded
the same day.

## Setup

Production-indexed temporary fixture (`session_message` indexes as in the
generated profile), 240 in-range messages plus 60 out-of-range, cutoff
1000, payloads padded to ~26.5 KB (average 26,603 B, close to the live
database's ~27 KB). SQLite 3.53.3, default `cache_size`. The probe compares:

1. **committed** — the current staged direct-search SQL;
2. **validated-materialized** — `cotail_validated_message AS MATERIALIZED`;
3. **scoped-materialized** — `cotail_scoped_message AS MATERIALIZED`; and
4. **operation-owned-text-documents** — an operation-owned CTE that emits
   only the text-document family the search actually queries.

## Results

| Variant | Validator calls | Elapsed | Range searches | Physical scans | Rows |
|---|---:|---:|---:|---:|---:|
| committed | 1,680 (**7.0×** in-range) | 108.7 ms | 15 | 0 | 4 |
| validated-materialized | 240 (1.0×) | 68.8 ms | 3 | 0 | 4 |
| scoped-materialized | 1,920 (8.0×) | 112.4 ms | 1 | 0 | 4 |
| operation-owned-text-documents | 240 (1.0×) | **18.5 ms** | 3 | 0 | 4 |

All variants return identical rows. The committed plan inlines
`cotail_validated_message` into every `cotail_document` union branch, so the
JS-registered validator runs once per branch per message; the plan shows 15
separate `time_created` range searches feeding those branches, where the
tighter variants show 3.

## Reading

1. **The committed SQL multiplies validation by union width.** Seven
   branches × one `json_type`-guarded validator call each. Materializing
   `cotail_validated_message` alone collapses the redundancy to 1× for a
   1.6× speedup — without changing the document model.
2. **Materializing the wrong CTE makes it worse.** Forcing
   `cotail_scoped_message` MATERIALIZED raises calls to 8× — the validator
   then also serves the scope rescan. CTE materialization is not a free
   knob; each placement changes who re-enters the function.
3. **An operation-owned text-document CTE is ~5.9× faster than committed**
   on this fixture (18.5 ms vs 108.7 ms) with the cleanest plan — but it
   forks the document model per operation, which the accepted architecture
   has so far avoided. It is the upper bound on what statement-shape work
   can buy before touching the validator policy.
4. **Scaling, not fixture speed, is the real finding.** Live 7-day windows
   are ~40,000 messages; 7× × 27 KB × 40,000 of V8 churn is a guaranteed
   heap death, which is precisely what
   [live-reprobe0](/.design/pushdown/live-reprobe0.glm53.md) then observed.
   Even the 1× variants pay O(window × payload) JS validation for witness
   qualification that only strictness — not semantics — requires.

## Disposition

The cheapest correct fix is policy, not statement shape: witness
qualification should not invoke the JS validator at all (branch-local
`json_type` guards already enforce document shape), and strict validation
belongs on selected hits in `hydrated_hits`, where it already runs. The
materialization and operation-owned variants remain useful as measured
reference points if validator-free qualification still underperforms.

## Cross-References

- [Live re-probe](/.design/pushdown/live-reprobe0.glm53.md) — the
  content-search OOM this probe predicts, plus the recommended fix.
- [After-action](/.design/pushdown/after-action0.gpt56s.md) — its
  evidence-off omission criterion is the intent this finding shows is not
  yet met.
- [Logical world](/packages/query-kysely/src/relations/world.ts) — the
  multi-branch `cotail_document` union under measurement.
- [Search core draft](/.design/search/draft0.glm53.md) — Tier-1 modes
  widen the union consumers; validator policy should land before they do.
