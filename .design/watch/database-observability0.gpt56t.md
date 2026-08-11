---
type: Research
title: Watch database observability baseline
description: Empirical limits and useful queries for deriving live session activity from OpenCode's SQLite projections.
tags: [cotail, watch, sqlite, polling, sessions, activity]
status: draft
generated: { by: model:gpt56t, at: 2026-08-11T19:01:17-04:00 }
sources:
  - id: cotail-history
    resource: /src/commands/history.ts
    title: Current history command
    author: project:opencoattails
  - id: cotail-session-query
    resource: /src/opencode/session.ts
    title: Current active-session query
    author: project:opencoattails
  - id: local-opencode-db
    resource: file:///home/rektide/.local/share/opencode/opencode-local.db
    title: Local OpenCode SQLite projection inspected on 2026-08-11
---

# Watch Database Observability Baseline

## Situation

The proposed command has two projections over one changing session set:

- an append-only, history-like activity stream; and
- a repeatedly maintained ranking that occupies the terminal screen.

The first implementation can read the same live SQLite database as `history`,
but a projection database does not necessarily retain every causal event. The
first design rule is therefore to distinguish an **observed transition** from a
source event. Polling can truthfully say that a session appeared, changed, or
fell outside the selected universe between two samples. It cannot always say
which tool, message mutation, or execution event caused that transition.

Research prompt for a later pass: compare snapshot-derived session transitions
with OpenCode's live event subscription and durable session log, then define a
single normalized activity contract with explicit fidelity and recovery fields.

## Current Read Path

`history` parses a recency horizon, opens the discovered database read-only,
runs `countActiveSessions`, renders once, and closes the connection
([`history.ts`](/src/commands/history.ts#L120-L163)). Its row already contains
the useful baseline fields: identity, title, directory, created/updated times,
and recent/total message counts
([`types.ts`](/src/opencode/types.ts#L22-L31)).

`countActiveSessions` is suitable for a one-shot report, not unchanged for a
tight refresh loop:

- it scans `session` by `time_updated`, sorts, and then calculates correlated
  count subqueries for every selected row;
- it correctly handles whichever of `message` and `session_message` exists;
- its message count predicates use the existing `(session_id, time_created, id)`
  indexes ([`session.ts`](/src/opencode/session.ts#L11-L38)); and
- database discovery and read-only opening are already isolated
  ([`db.ts`](/src/opencode/db.ts#L6-L29)).

The watch implementation should preserve these semantics while separating the
cheap **membership sample** from optional **row enrichment**.

## Empirical Snapshot

Inspection of
`/home/rektide/.local/share/opencode/opencode-local.db` on 2026-08-11 found:

| Observation | Result | Consequence |
| --- | ---: | --- |
| legacy `session` rows | 5,254 | The current history query sees only this generation. |
| native `session_v2` rows | 5,562 | Current history/watch reuse would omit at least 308 newer IDs. |
| Persisted `event` rows grouped by type | none | This database cannot currently supply a durable fine-grained event feed. |
| `session.time_updated` index | none | Membership and ranking require a small full session scan plus sort. |
| `message` index | `(session_id, time_created, id)` | Total and recent counts are efficient per selected session. |
| Database size | about 19.7 GB | Avoid repeatedly scanning content/event payload tables when metadata suffices. |

`EXPLAIN QUERY PLAN` for the current history shape confirmed a `session` scan,
a temporary B-tree for `ORDER BY`, and covering-index searches for both message
count subqueries. At this scale the metadata scan is reasonable, but doing
count subqueries for thousands of off-screen rows is unnecessary work.

This is one local data point, not a schema guarantee. It exposes a prerequisite:
the watch inventory must normalize both `session` and `session_v2`, deduplicate
overlapping IDs, and prefer the current native projection. Reusing
`countActiveSessions` unchanged cannot satisfy “everything available.”

The source already detects
V1 content in `part` and V2 content in `event` for search
([`source.ts`](/src/opencode/source.ts#L48-L53)); watch must similarly tolerate
different table populations instead of equating table existence with useful
event retention.

## Three Different Sets

“Everything available” needs three explicit levels:

1. **Universe:** all sessions matching stable filters such as directory and a
   recency horizon. This may contain thousands of sessions.
2. **Ranking:** a total, deterministic ordering over that universe, even when
   only part of it fits on screen.
3. **Viewport:** the rows currently rendered, bounded by terminal height, with
   an honest `shown / available` footer.

Conflating these creates either a misleading “all” display or an unusable
terminal. The first draft should default to a finite recency horizon inherited
from `history` and permit an explicit all-time universe. Terminal height should
only constrain the viewport, never silently change membership or rank.

## Snapshot-Derived Activity

A minimal polling engine can keep a map keyed by session ID containing the last
observed fields and derive:

| Transition | Detection | Honest stream label |
| --- | --- | --- |
| Entered | absent before, present now | `appeared` |
| Updated | `time_updated` or selected fields changed | `updated` |
| Rank movement | rank changed without content change | normally dashboard-only |
| Left | present before, absent now | `left-window` or `filtered-out` |
| Removed | ID no longer exists in an unbounded sample | `removed` |

The engine should not emit one line on every poll for an unchanged active
session. It should coalesce multiple database mutations observed in one sample
into one transition, include `observedAt`, and retain the source's
`time_updated`. A future event-backed source can add an event sequence and
precise kind without changing the renderer's basic input.

Cold-start behavior must be explicit because there is no prior snapshot:

- dashboard mode naturally renders the initial snapshot;
- stream mode should default to a compact initial history snapshot followed by
  transitions, preserving the requested correspondence to `history`;
- automation needs a `--no-initial` form so it can consume only changes after
  startup.

## Ranking Baseline

The least surprising initial rank is the existing history order:

```text
time_updated DESC, id ASC
```

The ID tie-breaker prevents rows from jittering when timestamps tie. Message
velocity or execution status can become alternate rank strategies only when
their source and time window are clearly defined. A score that mixes recency,
counts, queued work, and attention would be harder to explain and less stable.

The dashboard may annotate deltas (`+2`, `new`, `updated`) without allowing the
annotation itself to perturb rank. This separates **what is newest** from **what
changed since the prior sample**.

## Recommended Query Split

Use a long-lived read-only connection and two operation-shaped reads:

1. Sample session identity and metadata for the selected universe, ordered by
   the rank key. Normalize legacy `session` and native `session_v2`; do not touch
   message bodies.
2. Enrich only newly visible, changed, or explicitly requested rows with
   recent/total counts.

The boundary should be an internal observation source, not a generic SQL query
builder. Both output modes consume the same normalized snapshot/transition
objects, while stream and dashboard renderers own terminal behavior.

Polling cadence should use a non-overlapping async loop: schedule the next read
after the current sample completes, honor an abort signal, and let database
errors fail visibly. A configurable interval is useful, but correctness should
not depend on a particular millisecond default.

## Limits And Follow-Up

- Polling can miss intermediate updates and cannot reconstruct exact ordering
  inside an interval.
- The metadata source is currently split across legacy `session` and native
  `session_v2`; normalization must precede watch and should later be shared by
  finite history.
- `time_updated` is a coarse activity signal; changes to pending work or live
  execution may not map cleanly onto it.
- A V2 event subscription may be volatile, while a durable log may need cursor
  and reconnect semantics. These should be a second source, not assumptions
  embedded in the SQLite sampler.
- Session deletion versus falling outside `--since` is distinguishable only if
  the sampler checks existence outside the bounded universe.
- Re-evaluate count-query cost with realistic active windows before choosing
  enrichment defaults.

## Recommendation

Ship the first watch slice as a projection watcher with explicit fidelity:

- one shared session sampler and snapshot differ;
- `stream` and `rank` as separate render policies;
- deterministic recency ranking;
- bounded visible rows but complete matching-set counts;
- transition JSONL suitable for pipes;
- no claim of exact event capture; and
- an observation-source seam reserved for Codance/OpenCode event integration.

## Cross-References

- [`history-viewer/design.md`](/.design/history-viewer/design.md) established
  `time_updated` as the history membership and sort signal and deliberately
  deferred live watch; this note identifies the smallest truthful extension.
- [`query/README.md`](/.design/query/README.md) makes session metadata in the
  live database authoritative and sessions the stable result unit. The sampler
  preserves both invariants.
- [`codance cadence policy`](file:///home/rektide/src/codance/.design/cadence-policy/init0.ds4f.md)
  catalogs richer live execution, step, tool, pending-input, and attention
  signals. Those are candidates for a later high-fidelity observation source,
  not requirements for the polling baseline.
- [`source-and-lifecycle0.explore.md`](/.design/watch/source-and-lifecycle0.explore.md)
  supplies the hybrid filesystem/data-version monitor, current `session_v2`
  compatibility gate, and exact-event source options.
