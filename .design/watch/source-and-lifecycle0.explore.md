---
type: Research
title: Watch source and lifecycle seams
description: Discovery of change detection, storage generations, exact-event options, and watcher lifecycle for cotail watch.
tags: [cotail, watch, sqlite, wal, cdc, opencode-v2, lifecycle]
status: draft
generated: { by: agent:explore, at: 2026-08-11T00:00:00Z }
sources:
  - id: cotail-source
    resource: /src
    title: Current cotail source
    author: project:opencoattails
  - id: opencode-cdc
    resource: file:///home/rektide/src/opencode-session-fab/crates/opencode-cdc
    title: Existing OpenCode SQLite CDC implementation
    author: project:opencode-session-fab
  - id: opencode-current
    resource: file:///home/rektide/archive/anomalyco/opencode
    title: Current OpenCode source archive
    author: organization:anomalyco
---

# Watch Source And Lifecycle Seams

## Situation

The first watch implementation needs to wake promptly when OpenCode commits,
recover when filesystem notifications are missed, avoid expensive unchanged
queries, and restore the terminal reliably. It must also choose whether it is a
snapshot watcher or an exact event tailer.

The strongest initial direction is a continuously refreshed history projection.
Exact journal activity is valuable, but it carries cursor, compaction,
deduplication, versioning, and reconnect semantics that should not be rebuilt
casually inside a terminal command.

Research prompt for follow-up: characterize the current `session_v2` migration,
event retention, and `opencode-cdc` compatibility well enough to decide whether
cotail should depend on that crate/tool, port only its change monitor, or consume
OpenCode's durable session-log API.

## Existing Cotail Lifecycle

`history` currently:

1. parses `--since` immediately into one cutoff;
2. discovers and opens one read-only database;
3. runs `countActiveSessions` once;
4. renders once; and
5. closes the connection.

References: [`args.ts`](/src/args.ts#L16-L21),
[`history.ts`](/src/commands/history.ts#L120-L163), and
[`session.ts`](/src/opencode/session.ts#L11-L38).

Three changes are required for a long-running command:

- retain one read-only connection so `PRAGMA data_version` can detect commits by
  other connections;
- represent relative durations rather than freezing them at startup, so a
  trailing `24h` horizon continues to slide; and
- move query and rendering behind separate operations so both log and rank use
  one sample.

The package uses Node 22+, built-in `node:sqlite`, and no meaningful external
runtime dependencies ([`package.json`](/package.json#L1-L33)). `node:fs.watch`,
timers, and SQLite pragmas are sufficient for the monitor baseline.

## Proven Change Monitor

`opencode-session-fab` already implements the relevant pattern:

- watch the **parent directory**, because `-wal` and `-shm` sidecars appear and
  disappear;
- filter notifications to the database path prefix;
- debounce the burst produced by one commit;
- retain a periodic timeout as a safety net for missed notifications; and
- query only when `PRAGMA data_version` changed.

The complete loop is in
[`watch.rs`](file:///home/rektide/src/opencode-session-fab/crates/opencode-cdc/src/watch.rs#L81-L169).
Its `TailOptions` defaults to a 1.5-second safety poll and 25-millisecond
debounce, though cotail should treat those as evidence, not an immutable user
contract
([`tail.rs`](file:///home/rektide/src/opencode-session-fab/crates/opencode-cdc/src/tail.rs#L61-L100)).

`PRAGMA data_version` is explicitly used as a cheap cross-connection commit
detector
([`store.rs`](file:///home/rektide/src/opencode-session-fab/crates/opencode-cdc/src/store.rs#L188-L194),
[`tail.rs`](file:///home/rektide/src/opencode-session-fab/crates/opencode-cdc/src/tail.rs#L210-L217)).
This only works as intended when the same reader connection compares successive
values; reopening every cycle discards the comparison.

For cotail, filesystem events are wake hints, not correctness. If `fs.watch`
cannot be established or loses events, the safety poll still discovers a
changed data version. Multiple wakes must not produce overlapping samples.

## Database Discovery During Watch

Cotail currently chooses the database whose main file has the newest mtime
([`db.ts`](/src/opencode/db.ts#L6-L24)). In WAL mode, an active writer may touch
the WAL while the main file remains unchanged.

The CDC implementation ranks each database by the newest mtime of its main file
and `-wal` sidecar
([`store.rs`](file:///home/rektide/src/opencode-session-fab/crates/opencode-cdc/src/store.rs#L99-L143)).
Watch should adopt this discovery rule before startup. It should not silently
switch databases after startup; a channel switch is a new source identity and
needs explicit behavior if ever supported.

## Storage Generation Gap

Current cotail reads session metadata only from legacy `session`. Current
OpenCode defines the native session projection as `session_v2`
([`sql.ts`](file:///home/rektide/archive/anomalyco/opencode/packages/core/src/session/sql.ts#L21-L71)).
The August migration creates `session_v2` and reconnects `session_message` and
`session_pending` foreign keys to it
([`20260804233008_loose_psylocke.ts`](file:///home/rektide/archive/anomalyco/opencode/packages/core/src/database/migration/20260804233008_loose_psylocke.ts#L45-L117)).

The live database inspected for this research contains both generations, with
5,254 `session` rows and 5,562 `session_v2` rows. Therefore watch must not
entrench `countActiveSessions` unchanged. First introduce a storage-neutral
history snapshot operation that:

- detects available metadata projections;
- normalizes legacy and native rows;
- deduplicates IDs when generations overlap;
- takes native/current metadata as authoritative on collision; and
- joins counts to the content relation appropriate to each session generation.

This is a prerequisite for a claim that rank covers everything available.
Ideally `history` later adopts the same operation so the finite and watched views
cannot drift.

## Snapshot Diff Semantics

Key snapshots by session ID and compare normalized fields. The useful observed
transitions are:

- entered selection or newly created;
- changed title, directory, timestamps, state annotation, or counts;
- left a moving time window; and
- no longer available.

A bounded snapshot cannot distinguish aging out from deletion without an
existence lookup or journal evidence. Use `left-selection` until the source can
prove a more specific kind. Relative horizons must recompute their cutoff before
every sample; absolute timestamps remain fixed.

## Exact Activity Options

### SQLite journal tail

The durable event table can provide precise activity records, but `rowid` alone
is not a durable identity. The CDC implementation scans by rowid for commit
order while retaining per-aggregate sequence high-water marks because aggregate
deletion/compaction can permit rowid reuse
([`tail.rs`](file:///home/rektide/src/opencode-session-fab/crates/opencode-cdc/src/tail.rs#L110-L163)).

An event tail therefore needs:

- a scan cursor;
- `(aggregate_id, seq)` deduplication;
- bounded batches and drain loops;
- a versioned event decoder or raw-event fallback;
- replay/start-now policy; and
- cursor persistence if restart continuity matters.

This machinery is not needed to maintain a truthful snapshot rank. Reuse
`opencode-cdc` or add an explicit journal source later rather than hiding it in
the first SQLite sampler.

### OpenCode durable session log

OpenCode exposes an experimental per-session SSE log with an exclusive
aggregate sequence cursor and `follow=true`
([`session.ts`](file:///home/rektide/archive/anomalyco/opencode/packages/protocol/src/groups/session.ts#L628-L645)).
It offers durable replay and a synchronization boundary, but requires a
cooperating server and one stream per known session. It is a strong optional
high-fidelity backend, not the easiest source for global inventory/discovery.

### Volatile live status

`session.status` carries exact `idle | retry | busy` state but is explicitly an
ephemeral event
([`session-status-event.ts`](file:///home/rektide/archive/anomalyco/opencode/packages/schema/src/session-status-event.ts#L9-L49)).
Projection-only watch must not label a session exactly busy or idle. Durable
execution start/end events can support inferred state; an HTTP/event adapter can
support exact live state with reconnect reconciliation.

## Lifecycle Recommendation

The watch runner should:

1. discover the source using DB+WAL freshness;
2. open one read-only connection and establish the initial data version;
3. load an initial normalized legacy/native snapshot;
4. start a parent-directory watcher plus periodic safety wake;
5. debounce filesystem bursts;
6. gate sampling on changed `data_version` or a moving-horizon expiry;
7. derive one transition batch and one ranked snapshot;
8. send those products to independent renderers; and
9. abort monitoring, close the source, and restore terminal state in `finally`.

A moving horizon creates a subtle exception to pure `data_version` gating:
sessions can leave the trailing window while the database is unchanged. The
safety wake must check whether the next known expiry has passed, or simply
resample at the safety cadence when relative selection is active.

## Recommendation

Implement watch as a normalized snapshot watcher first, using the proven hybrid
change monitor. Make metadata-generation normalization the first gate. Preserve
an observation-source seam for exact journal or HTTP log activity, and describe
projection-derived state as observed/recent rather than exact running status.

## Cross-References

- [`database-observability0.gpt56t.md`](/.design/watch/database-observability0.gpt56t.md)
  measures the current query plan and defines universe, rank, and viewport.
- [`history-viewer/design.md`](/.design/history-viewer/design.md) defines the
  finite history behavior to preserve, while its old assumption that live watch
  necessarily requires CDC is narrowed here: snapshot watch does not; exact
  activity tailing does.
- [`v2.md`](/.design/v2.md) describes the earlier event-sourced layout and
  per-session durable log. Current `session_v2` migration details supersede its
  assumption that `session` remains the metadata table.
- [`bookmarks/applications.glm52.md`](/.design/bookmarks/applications.glm52.md)
  proposes exact fork/compaction auto-producers. Those should consume a journal
  or durable-log source, not snapshot guesses.
