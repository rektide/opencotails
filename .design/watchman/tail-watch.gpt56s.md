---
type: Exploration
title: Cotail tail and watch known-versus-supposed report
description: Explicitly non-authoritative draft separating verified tail/watch implementation facts from hypotheses about what watch ought to become.
resource: /.design/watchman/tail-watch.gpt56s.md
tags: [cotail, tail, watch, activity, observation, sqlite, non-authoritative]
status: draft
generated: { by: model:openai/gpt-5.6-sol#xhigh, at: 2026-09-02T04:25:34Z }
sources:
  - id: recent-message-activity
    resource: /packages/query-kysely/src/operations/recent-message-activity.ts
    title: Recent Message activity operation
  - id: tail-command
    resource: /src/commands/tail.ts
    title: Cotail tail command
  - id: watch-command
    resource: /src/commands/watch.ts
    title: Cotail watch command
  - id: watch-engine
    resource: /src/watch/activity.ts
    title: Message activity watch engine
  - id: pushdown-review
    resource: /.design/pushdown/draft4-review.gpt56s.md
    title: Demand-bounded query review
---

# Cotail Tail And Watch: Known Versus Supposed

## Authority Warning

This is a non-authoritative exploration/report. It records facts checked against
the current implementation and labels design hypotheses separately. It is not a
promise that the supposed direction will ship, and it does not supersede source,
tests, CLI help, or accepted architecture.

The filename suffix `gpt56s` abbreviates the invocation's reported underlying
model, `openai/gpt-5.6-sol#xhigh`; it does not name the OpenCode harness.

## Known

- OpenCode's authoritative Message projection is `session_message`, and the
  indexed fixture supplies a global `session_message(time_created)` index.
- [`logicalRootWorld`](/packages/query-kysely/src/relations/world.ts) can seed
  Session roots plus time-scoped raw Message metadata without adding validated
  Message, document, JSON expansion, or payload-derived relation families.
- [`recentMessageActivityQuery`](/packages/query-kysely/src/operations/recent-message-activity.ts)
  uses that root/message-only world, joins authoritative `session_v2` roots,
  applies a required half-open Message-created range, and enforces a positive
  finite limit.
- Activity results are proper Message `Observation`s. Their `Target` contains a
  profile-derived source ID, nested Session address, and Message ID. Values add
  Message type, sequence, creation/update times, Session title, and directory.
- Indexed plan tests require `SEARCH session_message ... time_created`, reject a
  physical `SCAN session_message`, reject payload/document SQL, and prove zero
  payload validation even when selected payload strings are malformed.
- `cotail tail` defaults to a 24-hour cutoff and 50 rows. It sorts by
  `(time_created DESC, message_id DESC)` and emits no header or footer. Human
  lines are tab-delimited; JSONL has stable source/session/message identity.
- `cotail watch` acquires one read-only source for its lifetime and repeatedly
  invokes the same recent-activity operation under fresh logical reads. It does
  not parse Message payloads or define a second meaning of activity.
- Relative `watch --since` values move with the injected clock. ISO cutoffs stay
  fixed. Samples cannot overlap because the loop waits only after the prior
  sample and emission finish.
- The watch engine deduplicates source-qualified Message IDs seen by this
  process. It emits `initial` or `subsequent` observations oldest-first within a
  batch, never labels them events, and supports a silent initial baseline.
- `watch --once` executes one bounded sample and exits. SIGINT and SIGTERM abort
  the wait/loop and release the acquired source; stdout EPIPE is quiet; other
  source/output failures remain visible.

## Implemented

### Finite activity

[`cotail tail`](/src/commands/tail.ts) is the finite product suggested by the
[pushdown review](/.design/pushdown/draft4-review.gpt56s.md). Its work is bounded
by both the Message-created window and result limit, independently of older
database content. It deliberately omits content, model, tools, completion
interpretation, and causal labels.

### Observed activity

[`cotail watch`](/src/commands/watch.ts) is an append-only observation process,
not a maintained rank or exact event tail. The pure
[watch engine](/src/watch/activity.ts) accepts an activity source, cutoff clock,
wake, cancellation signal, and async emitter. Production supplies periodic
wakes; tests supply deterministic fakes.

The output envelope is intentionally explicit:

```json
{"observation":"subsequent","observed_at":"2026-09-02T04:25:34.000Z","source_id":"opencode-local","session_id":"ses_...","message_id":"msg_...","message_type":"assistant","message_seq":42,"time_created":"2026-09-02T04:25:33.000Z","time_updated":"2026-09-02T04:25:33.500Z","session_title":"Example","session_directory":"/work/example"}
```

`observed_at` belongs to Cotail's polling process. `time_created` and
`time_updated` are physical Message metadata. Neither timestamp proves when a
transaction committed or which higher-level action caused the row.

## Supposed Watch Direction

The current append-only activity surface is useful on its own. If watch grows,
the strongest supposed direction is several explicit products sharing identity,
not one command silently changing fidelity:

1. **Complete Message observation.** Add keyset pagination/draining or an
   overflow record so consumers can distinguish a complete interval from a
   finite top-N sample. Timestamp cursors need an overlap/recovery argument
   because creation time is not necessarily commit order.
2. **Efficient wake hints.** Parent-directory filesystem watching and a
   persistent-connection `PRAGMA data_version` gate could reduce idle samples.
   The periodic wake remains correctness fallback. This should follow measured
   need, not the age of the earlier design.
3. **Exact activity adapters.** Durable OpenCode Event or per-Session log sources
   could add occurrence fidelity only with explicit cursors, retention,
   reconnect reconciliation, event-version handling, and deduplication.
4. **Inventory and rank.** A maintained screen should consume a complete current
   inventory and a pure ranking policy. Recent Message observations may annotate
   it, but cannot justify exact `busy`, `idle`, `finished`, or `needs attention`
   labels on their own.
5. **Semantic workflow sources.** Codance or another workflow layer might supply
   human intent and attention states later. Such records should be versioned
   facts from that source, not guesses derived from Session or Message changes.

## Uncertainties

- **Sample overflow:** each poll sees only the newest `--limit` Messages in the
  selected window. More arrivals than that between samples can be missed. The
  current label "newly visible" is honest, but no overflow record quantifies the
  gap.
- **Identity mutations:** an already observed Message ID is not emitted again if
  its metadata or Session title changes. The command observes Message appearance,
  not Message revisions.
- **Timestamp order:** `time_created` gives the indexed activity order, not a
  proven global transaction/commit order. Exact ordering needs an event cursor
  or stronger upstream contract.
- **Source identity:** `source_id` is the decoded profile ID. It is useful and
  stable within this profile workflow, but no durable source catalog currently
  handles relocation, aliases, or collisions across independently created
  profiles.
- **Idle cost:** production uses periodic indexed sampling rather than
  filesystem wake hints or `data_version`. The practical idle cost has not been
  benchmarked in this change.
- **Rank product:** earlier research proposes recency and attention ranks, but no
  current source supplies all required current-state and attention facts. The
  appropriate universe, TTY contract, and status fidelity remain open.
- **Runtime matrix:** full suites were verified on the installed Node 26 runtime.
  Focused operation, CLI, output, and lifecycle suites also passed under
  temporary `pnpm dlx` Node 22.23.2 and Node 24.20.0 runtimes. Those versions
  are not installed as persistent local executables.

## Cross-References

- [Watch research entry point](/.design/watch/README.md) matters as the map from
  historical proposals to the smaller shipped baseline; it explicitly marks
  stale assumptions and unimplemented mechanisms.
- [V2 relational query world](/.design/query/design3.gpt56.md) supplies the
  Address, Target, Observation, logical relation, and read provenance vocabulary
  used by the operation rather than inventing CLI-only identity.
- [Query design index](/.design/query/index.md) matters for broader architecture
  lineage and the distinction between implemented evidence and forward designs.
- [Pushdown review](/.design/pushdown/draft4-review.gpt56s.md) is direct prior
  art: it identifies global recent activity over `time_created` as the cheapest
  unproductized indexed surface. Tail implements that item.
- [Pushdown after action](/.design/pushdown/after-action0.gpt56s.md) supplies the
  operation-owned cost-envelope and plan-conformance discipline inherited by the
  new query, while its long-lived-host discussion remains future measurement.
- [Development ideas](/.design/ideas/ideas.gpt56s.md) matters as the broader
  activity/rank/exact-source roadmap. Its two-projection watch is a hypothesis,
  not a statement of shipped behavior.
- [Isolated OpenCode channel research](/.test-agent/opencode-test-channel/README.md)
  explains why no local/main OpenCode process or database was used. This work
  relies only on indexed temporary fixtures and fake lifecycle sources.
