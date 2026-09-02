# Cotail Watch Research

This directory contains the research lineage that preceded the first shipped
`cotail tail` and `cotail watch` activity products. The current implementation
is deliberately smaller than the earlier proposals: it observes bounded recent
Message metadata and does not yet implement a ranked screen, filesystem wakes,
`PRAGMA data_version` gating, or exact event replay.

Start with the explicitly non-authoritative
[tail/watch exploration](/.design/watchman/tail-watch.gpt56s.md). It separates
facts verified against the current code from hypotheses about what watch ought
to become.

## Shipped Baseline

```text
cotail tail  [--since <duration-or-ISO>] [--limit <n>] [--format human|jsonl]
cotail watch [--since <duration-or-ISO>] [--limit <n>] [--interval <duration>]
             [--format human|jsonl] [--no-initial] [--once]
```

Both commands consume the same metadata-only recent Message activity operation.
It uses the `session_message(time_created)` access path, returns source-qualified
Session and Message identity, and never hydrates or validates Message payloads.

`tail` is finite and newest-first. `watch` repeatedly samples that same finite
view, emits newly observed identities oldest-first within each batch, and labels
each record `initial` or `subsequent`. These labels describe this process's
observations. They do not claim to reconstruct exact causal events or every
intermediate database state.

## Research Lineage

- [Initial watch plan](/.design/watch/draft0.gpt56t.md) proposed a broad
  snapshot inventory, activity stream, and maintained rank. Its product split
  remains useful, but its storage-normalization prerequisite is stale because
  current Cotail already reads authoritative `session_v2` roots.
- [Database observability baseline](/.design/watch/database-observability0.gpt56t.md)
  supplied the inventory/activity distinction and warned against causal claims
  from polling. Its measurements and legacy-query discussion are historical.
- [Source and lifecycle seams](/.design/watch/source-and-lifecycle0.explore.md)
  documents parent-directory watches, WAL wake hints, `data_version`, and exact
  event alternatives. Those mechanisms are candidates, not shipped behavior.
- [Terminal and ranking lead](/.design/watch/terminal-and-ranking0.ds4f.md)
  explores rank frames, TTY cleanup, resize, and stable ties. The first release
  ships append-only activity only.
- [Codance crossover](/.design/watch/codance-crossover0.general.md) describes a
  possible future semantic source. Cotail currently has no Codance dependency.

## Current Boundary

The first version favors a testable, honest polling loop:

- one long-lived acquired read-only source;
- one bounded indexed metadata query per non-overlapping sample;
- a moving cutoff for relative `--since` and fixed cutoff for ISO values;
- in-process Message-identity deduplication;
- injectable source, clock, wake, signal, and emitter seams;
- clean `SIGINT`, `SIGTERM`, and `EPIPE` termination; and
- `--once` for finite automation and integration tests.

The finite per-sample limit is also a fidelity limit. More Messages than the
visible limit between samples can be missed, and updates to an already observed
Message identity are not a second observation. The CLI says "observe newly
visible Message metadata" rather than promising an exact event tail.

## Supposed Next Direction

Further work should be driven by a concrete product need rather than completing
the old plan mechanically:

1. Add an explicit overflow or pagination contract if complete recent-Message
   observation is required.
2. Measure periodic indexed sampling before adding filesystem wakes and
   persistent `data_version` gating.
3. Add exact durable event or session-log adapters only with cursor, reconnect,
   retention, and deduplication semantics.
4. Design maintained rank as a separate inventory projection. Do not infer
   exact busy, idle, completion, or attention state from Message snapshots.
5. Add a durable source catalog before treating profile IDs as relocatable
   cross-database identities.

## Cross-References

- [Tail/watch exploration](/.design/watchman/tail-watch.gpt56s.md) is the current
  known-versus-supposed map and links the implementation evidence.
- [Recent Message activity operation](/packages/query-kysely/src/operations/recent-message-activity.ts)
  is the shared semantic and query boundary for both commands.
- [Watch activity engine](/src/watch/activity.ts) defines the observation and
  lifecycle seams without owning SQLite or terminal globals.
- [Pushdown review](/.design/pushdown/draft4-review.gpt56s.md) identified the
  global `time_created` index as the cheapest unproductized access path; `tail`
  is the implemented result.
- [Query architecture](/.design/query/design3.gpt56.md) defines the
  source-qualified Target and Observation vocabulary used by activity rows.
- [Development ideas](/design/ideas/ideas.gpt56s.md) retains the broader rank
  and exact-source aspirations. It should be read as roadmap material, not a
  description of the current command.
