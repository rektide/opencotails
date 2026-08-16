---
type: Design
title: "cotail save-point — a general primitive for points in time (draft1)"
description: "Evolved design: `bookmark` is one instance of a broader `save-point` primitive. Defines a layered schema (Core identity / SessionDescriptor snapshot / content snapshot / user intent), bakes in root-session-id and fork lineage as core fields, and enumerates concrete places this primitive is useful today."
resource: /home/rektide/src/opencoattails/.design/bookmarks/draft1.glm52.md
tags: [cotail, cli, save-point, bookmark, session, fork-lineage, schema]
status: draft
generated: { by: agent:glm-5.2, at: 2026-08-04T00:00:00Z }
sources:
  - id: draft0
    resource: file:///home/rektide/src/opencoattails/.design/bookmarks/draft0.glm52.md
    title: "preceding draft — bookmarks-only framing"
  - id: cotail-session-report-epic
    resource: file:///home/rektide/src/opencoattails/.beads/issues.jsonl
    title: "existing epic defining a layered live SessionInfo — shares types with the snapshot descriptor"
  - id: session-schema-live
    resource: sqlite://~/.local/share/opencode/opencode.db
    title: "actual session table columns (v1 shape, 2205 sessions, 494 with parent_id)"
  - id: opencode-v2-fork-fields
    resource: file:///home/rektide/src/opencoattails/.design/v2.md
    title: "v2 adds fork_session_id + fork_message_id beyond v1 parent_id"
---

# `cotail save-point` — a general primitive for points in time

## What's new since draft0

draft0 framed the feature as **bookmarks** — a single-purpose subcommand that
snapshots the active session into a Turso/TSV store. In response, the user
pushed the design wider:

> "this idea at larger further reinforces a broad desire to have a general
> schema for save points, for points in time. that itself should probably be
> multiple things: a core primary key, then materialized optional data from
> the session, in a standard package, that can describe a session. fork
> lineage is some very very key information here that i would love to have.
> we should have a root session id for every session, absolutely, in the
> primary information. … what are places we could use this today?"

That reshapes the work. **Bookmarks become one instance** of a more general
**save-point** primitive. The primitive owns a small, layered schema that
*any* point-in-time record can use; the bookmark command is the first
producer. A reusable **SessionDescriptor** package — a standardized, safe-to-
snapshot slice of `SessionInfo` — sits in the middle, and **fork lineage +
root-session-id get first-class slots** in the core identity layer.

This draft supersedes draft0's flat `BookmarkRecord`. The CLI still ships as
`cotail bookmark` for ergonomics (it's the first concrete kind), but the
storage layer talks in `SavePoint` records with a `kind` discriminator.

## The pivot: bookmark → save-point

A **save-point** is a typed, addressable marker at a moment in a session's
life. Producers create them; consumers (read-back, search, export) read them.
Bookmarks are the user-driven producer; the schema admits other kinds
without changing storage:

| `kind` value | producer | what it marks |
|---|---|---|
| `bookmark` | `cotail bookmark` (this design) | a user-tagged moment |
| `fork-point` | (future) auto-created when a fork is detected | where one session branched from another |
| `compaction-boundary` | (future) auto-created around opencode compaction | context that's about to be lost |
| `decision` | (future, tagged bookmark alias) | an explicit decision with rationale |
| `milestone` | (future, tagged bookmark alias) | a goal-line marker |
| `handoff` | (future) agent-to-agent handoff point | cross-instance continuity |

`kind` is an open string — the schema doesn't enforce a vocabulary, so anyone
can introduce a new producer without migrating storage. Tags still carry
ad-hoc intent (`decision-point`, `bug-locus`, …) orthogonally.

## Layered schema

Four layers, each independently optional except **Core** (always present).
Every layer is a separate TS type, composed into `SavePoint`. This matches the
"core primary key + materialized optional data + standard session package"
framing the user asked for, and lets each producer pick how much to fill.

### Layer 0 — Core (identity; always present)

```ts
// src/savepoint/types.ts
export interface SavePointCore {
  id: string;                  // ULID — lexicographically time-ordered
  createdAt: number;           // epoch-ms, client clock
  kind: string;                // "bookmark" | "fork-point" | "decision" | ... (open)
  producer: string;            // "cotail:bookmark" | "cotail:auto:fork" | ... (auditable)

  // session-tree identity (the big addition over draft0)
  sessionId: string;           // the session this save-point is in
  rootSessionId: string;       // THE ancestor of the session tree (derived; == sessionId if no parent)
  parentSessionId: string | null;  // immediate parent (materialized for cheap query)
}
```

Why `rootSessionId` is in **Core** and not in the descriptor:

- It's **stable** — doesn't change as the session continues.
- It's **small** — one id, always derivable.
- It's the **natural primary query key** for "all work on this thread of
  thought", across forks. Without it, every consumer has to walk the parent
  chain.
- It's the unit at which you'd **share**, **export**, or **archive** a body
  of work.

`parentSessionId` is materialized alongside because it's the most common
follow-up question ("which session did this fork from?") and cheap to write
once.

### Layer 1 — SessionDescriptor (the "standard package")

A reusable snapshot of the *navigational* identity of a session — enough to
talk about a session without re-querying the live DB. Distinct from `SessionInfo`
([`/src/opencode/session-info.ts`](/src/opencode/session-info.ts)) which is the
**live** read shape; `SessionDescriptor` is the **frozen, snapshot-safe**
subset.

```ts
export interface SessionDescriptor {
  // identity & navigation
  sessionId: string;             // mirrors core.sessionId
  rootSessionId: string;         // mirrors core.rootSessionId (denormalized for standalone use)
  parentSessionId: string | null;
  title: string;
  directory: string;
  slug: string;
  projectId: string;
  version: string;               // "v1" | "v2" — which opencode schema this came from

  // time
  timeCreated: number;
  timeUpdated: number;           // session's updated-at at snapshot time

  // fork lineage — the bit the user explicitly called out
  fork: {
    sessionId: string | null;       // session this was forked from (== parentSessionId in v1)
    messageId: string | null;       // the message at which the fork happened (v2 only; null on v1)
    time: number | null;            // when the fork happened, if known
  };

  // lifecycle (nullable, present only when set)
  timeCompacting: number | null;
  timeArchived: number | null;
}
```

**Excluded on purpose:** `cost`, `tokens_*`, `share_url`, summary diffs,
anything live-only. Those change; freezing them into a snapshot misrepresents
the session over time. They live on `SessionInfo` for live reads (see the
existing `cotail-session-report` epic) and on Layer 2 snapshots if a producer
specifically wants a cost snapshot.

`SessionDescriptor` is the type future tools reach for when they need to
"describe a session" in a record — bookmarks today, exports/handoffs tomorrow.

### Layer 2 — ContentSnapshot (optional, configurable)

The actual prompt/reply text — what draft0 called "the message and reply".
Truncation is configurable per save-point invocation.

```ts
export interface ContentSnapshot {
  userMessage: string | null;        // latest user prompt, truncated (null if --no-message)
  assistantReply: string | null;     // latest assistant reply, truncated (null mid-turn or --no-reply)
  truncateMessage: number;           // chars actually used (records the setting at snapshot time)
  truncateReply: number;
  // future slots: reasoning, toolCalls, patch — additive only
}
```

Capturing `truncateMessage` / `truncateReply` *into* the record means a later
reader knows whether a 400-char `userMessage` was the whole prompt or just the
head. Without it, truncation is invisible.

### Layer 3 — Intent (optional)

The user-supplied parts.

```ts
export interface SavePointIntent {
  note: string | null;               // -m / positional after --
  tags: string[];                    // parsed, lowercased, deduped
}
```

### Composed

```ts
export interface SavePoint {
  core: SavePointCore;                       // always
  session: SessionDescriptor;                // usually (bookmark always sets it; bare core is allowed)
  content: ContentSnapshot | null;           // nullable; --no-message --no-reply → null
  intent: SavePointIntent | null;            // nullable; bare save-point has none
}
```

Backends persist this as a single record. TSV flattens it; Turso stores each
layer in its own JSON column (`core_json`, `session_json`, `content_json`,
`intent_json`) — keeping the SQL schema stable as layers evolve.

## Root session id — derivation and caching

`rootSessionId` is not a stored column in opencode's `session` table; it has
to be **derived** by walking the parent chain. v1 has `parent_id`; v2 adds
`fork_session_id` + `fork_message_id` ([`.design/v2.md`](/design/v2.md)). We
walk whichever the schema exposes:

```sql
-- v1 (current live DB shape: 2205 sessions, 494 with parent_id)
WITH RECURSIVE chain(id, parent_id) AS (
  SELECT id, parent_id FROM session WHERE id = ?
  UNION ALL
  SELECT s.id, s.parent_id FROM session s JOIN chain c ON s.id = c.parent_id
                                                           WHERE c.parent_id IS NOT NULL
)
SELECT id FROM chain WHERE parent_id IS NULL ORDER BY id LIMIT 1;
```

The v2 case walks `fork_session_id` the same way; the `Source` abstraction
already exists for v1/v2 splits, and `rootSessionIdOf(sessionId)` joins it.

**Caching:** the result is stable per session, so we memoize it in-process
for the life of one CLI invocation (a Map keyed by session id). We do **not**
write it back to opencode's DB — that's not ours to mutate. A future
materialized-view table in cotail's own DB could cache it across runs if the
walk ever shows up in profiles; today the chain is shallow (median fork
depth on the live DB is 1–2).

**On `parent_id == id` cycles or self-references:** defensively, the
recursive CTE bounded by `WHERE c.parent_id IS NOT NULL` plus the
`ORDER BY id LIMIT 1` will pick a deterministic root if a malformed chain
appears. We log and continue rather than throw — a broken lineage shouldn't
block a bookmark.

## Fork lineage — concrete fields

The user called this "very very key information." Concretely:

- **`session.fork.sessionId`** — which session this one branched from. In v1,
  this is just `parent_id` (and we copy it into `fork.sessionId` for a uniform
  shape across versions). In v2, it's `fork_session_id`.
- **`session.fork.messageId`** — the *exact message* at which the fork
  happened. v1 doesn't have this; v2 does. Null on v1.
- **`session.fork.time`** — when the fork happened. Derived from the forked
  message's `time_created` when available, else from the session's
  `time_created`.

Materializing these into the descriptor means a consumer can answer "show me
the moment this branch started" without re-doing the walk or hitting v2-only
tables.

## Where could we use this today?

The user asked. Save-points as a primitive open up concrete, near-term
applications — none of which require new opencode features, just cotail
reading what's already there. Ranked roughly by leverage:

### High-leverage, immediate

1. **Bookmarks** (this design) — the obvious producer. User marks a moment
   with a note and tags; later search by tag/session/lineage.
2. **Decision log** — `kind: bookmark` with `tags: [decision-point]`, used
   consistently. Becomes a queryable "why did we choose X" record across
   projects. The `decision-point` tag the user named is the seed.
3. **Cross-fork continuity** — *"where was I working on this thread?"* The
   `rootSessionId` key lets you list every save-point across every fork in a
   tree, giving a chronological narrative that `history` (per-session) can't.
4. **Fork-point auto-marking** — a `cotail watch`-style producer that notices
   new sessions with a non-null `parent_id`/`fork_session_id` and emits a
   `kind: fork-point` save-point, so forks are always annotated even when the
   user forgets. Pairs naturally with a future `cotail tree` view.
5. **Handoff between agents** — passing work from one opencode instance to
   another via a save-point id (just a string to drop in a message). The
   descriptor + content snapshot carry enough context to bootstrap the next
   agent without re-reading the whole session.

### Medium-leverage, near-term

6. **Compaction boundaries** — opencode sets `time_compacting` on the session
   row when it compacts. A producer that watches for that field gaining a
   value can emit `kind: compaction-boundary` save-points that preserve the
   prompt/reply just before context was lost.
7. **Daily journal** — auto-generated save-points at session-idle boundaries
   (or on a cron) summarizing "today I worked on these threads", grouped by
   `rootSessionId`. The descriptor + tags make this a thin read.
8. **Cost/token deltas** — snapshot `cost` and `tokens_*` (via the
   `cotail-session-report` epic's layer 3 fields) into a custom content
   snapshot kind to track *deltas* between save-points. Useful for
   "this decision cost $2 in tokens".
9. **Review/governance queue** — `kind: review-request`, pulled by a separate
   consumer (a GitHub issue creator, a Slack notifier). The save-point is the
   stable id everything refers back to.
10. **Test fixtures** — snapshot a session state as a save-point; a future
    `cotail replay` consumes the descriptor + snapshot to seed a deterministic
    test.

### Lower-leverage but interesting

11. **Diff/comparison** — two save-points in the same root tree → a
    "what diverged" view.
12. **Knowledge extraction** — collected save-points across projects as a
    personal reference corpus (decision patterns, bug loci).
13. **Audit trail** — for compliance-sensitive agent workflows, save-points
    as signed, append-only records (Turso's group-scoped tokens already give
    us auth scope).
14. **Replay markers / restore targets** — *mental* restore, not literal
    agent state. "Go back to this prompt and try a different fork" is the
    user-facing affordance; the save-point is its address.

The throughline: **save-points are addresses for moments**. Anything that
wants to refer to "the state of work at this point" benefits — bookmarks are
just the first instance where a human types the address.

## CLI surface (refined from draft0)

Producer name stays `bookmark` — it's the user-facing verb. The store layer
talks `SavePoint`. Output of a successful save is the new id (or full record
with `--json`), so the user can capture the address and refer to it later.

```
cotail bookmark [options] [-- note]
```

Flags (same as draft0, restated for the new schema):

```
Session resolution (inherited from get-session):
  [pid]                          positional opencode PID
  -s, --session <id>             use this session id directly
  -C, --directory <dir>          match by directory
  --db <path>                    opencode DB path (default: auto-discover)

Intent (Layer 3):
  -m, --message <text>           the note (alternative to positional after --)
  -t, --tags <list>              whitespace- and/or comma-separated

Snapshot (Layer 2):
      --truncate-message <chars>  default 400
      --truncate-reply <chars>    default 400
      --no-message                skip user prompt capture
      --no-reply                  skip assistant reply capture

Store (cross-cutting):
      --store <name>              turso | tsv (default: $COTAIL_STORE or turso)
      --tsv-path <path>           TSV file location
      --turso-db <name>           Turso DB name (default: cotail-bookmarks)

Output:
      --json                      emit the full saved SavePoint as JSONL
      --id-only                   print only the new save-point id (default)
  -h, --help

Session descriptor (Layer 1):
      --no-descriptor             store only Core + Intent (rare; for terse markers)
```

`--no-descriptor` is the escape hatch for ultra-cheap markers (e.g. a future
`fork-point` auto-producer that doesn't need title/directory). Today the
bookmark producer always sets the descriptor.

## Store interface (updated)

```ts
// src/savepoint/store.ts
export interface SavePointStore {
  readonly name: string;
  open(): Promise<void>;
  save(sp: SavePoint): Promise<void>;
  close?(): Promise<void>;

  // reserved for the read-side ticket — not implemented yet, but on the
  // interface so backends know they'll need to support them:
  // list(filter): AsyncIterable<SavePoint>;
  // get(id): Promise<SavePoint | null>;
}
```

`BookmarkStore` from draft0 is renamed `SavePointStore`. The two backends
(`TursoSavePointStore`, `TsvSavePointStore`) live under `src/savepoint/store/`.

### Turso schema (draft1)

```sql
CREATE TABLE IF NOT EXISTS save_points (
  id            TEXT PRIMARY KEY,            -- ULID
  created_at    INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  producer      TEXT NOT NULL,

  session_id    TEXT NOT NULL,
  root_session_id TEXT NOT NULL,
  parent_session_id TEXT,

  core_json     TEXT NOT NULL,               -- full SavePointCore (future-proof)
  session_json  TEXT,                        -- SessionDescriptor or null
  content_json  TEXT,                        -- ContentSnapshot or null
  intent_json   TEXT                         -- SavePointIntent or null
);
CREATE INDEX IF NOT EXISTS sp_created_at_idx     ON save_points(created_at);
CREATE INDEX IF NOT EXISTS sp_session_id_idx     ON save_points(session_id);
CREATE INDEX IF NOT EXISTS sp_root_session_id_idx ON save_points(root_session_id);
CREATE INDEX IF NOT EXISTS sp_kind_idx           ON save_points(kind);
```

The explicit columns (`session_id`, `root_session_id`, `parent_session_id`,
`kind`) duplicate data that's also inside the JSON blobs — that's deliberate,
so filtered queries (by root tree, by kind) don't need JSON extraction. The
JSON columns absorb schema evolution without migrations.

### TSV schema (draft1)

Header row + flat fields. The four-layer split is preserved by column
prefixing so a reader can identify layers:

```
c.id	c.createdAt	c.kind	c.producer	c.sessionId	c.rootSessionId	c.parentSessionId	s.title	s.directory	s.slug	s.projectId	s.version	s.timeCreated	s.timeUpdated	s.forkSessionId	s.forkMessageId	s.forkTime	s.timeCompacting	s.timeArchived	content.userMessage	content.assistantReply	content.truncateMessage	content.truncateReply	intent.note	intent.tags
```

Long, but explicit; `awk -F'\t'` friendly; and the prefixes make
column-extraction by layer trivial.

## Module layout (revised)

```
src/
├── cli.ts
├── commands/
│   └── bookmark.ts                 (producer — orchestrates resolution + save)
├── opencode/
│   ├── source.ts                   (extended: latestTextByRole)
│   ├── v1/source.ts
│   ├── v2/source.ts
│   ├── session-info.ts             (extended: rootSessionIdOf(sessionId))
│   └── lineage.ts                  (NEW — recursive walk, memoized)
└── savepoint/                      (NEW — replaces draft0's src/store/)
    ├── types.ts                    (SavePoint, SavePointCore, SessionDescriptor, ...)
    ├── descriptor.ts               (build SessionDescriptor from SessionInfo + lineage)
    ├── snapshot.ts                 (capture ContentSnapshot via Source.latestTextByRole)
    ├── store.ts                    (SavePointStore interface)
    ├── registry.ts                 (resolveStore)
    └── store/
        ├── turso.ts
        └── tsv.ts
```

`src/savepoint/` is the future-plugin home. Naming it `savepoint` (not
`store`) makes the domain explicit and leaves `store/` free as a sub-package
for the backend implementations.

## Open decisions (carry over + new)

Carry-over from draft0:

1. **CLI framework** (hand-rolled vs gunshi vs effect). *Still recommend
   hand-rolled for this ticket.*
2. **ULID vs UUID.** *ULID — even more compelling now that `rootSessionId`
   grouping + sort-by-time matters for cross-fork narratives.*
3. **`--store` placement** (top-level vs inside `bookmark`). *Still inside
   `bookmark` until the second consumer arrives.*

New in draft1:

4. **Read-side scope.** This design is **write-only**. Should the *interface*
   reserve `list`/`get` (yes — done above) and the *first read command*
   (`cotail bookmarks ls` / `cotail savepoints ls`) be a separate ticket?
   *Recommendation: yes, separate. Land write + schema first.*
5. **`kind` validation.** Open vocabulary today (any string). Should the CLI
   expose `--kind <name>` so users can mint ad-hoc kinds, or should kinds be
   producer-determined only (bookmark producer always emits `kind: bookmark`)?
   *Recommendation: producer-determined for now; `kind` becomes user-set only
   when a second producer arrives.*
6. **Lineage walk failure mode.** Throw, or fall back to `rootSessionId =
   sessionId`? *Recommendation: fall back with a stderr warning, so a broken
   opencode DB doesn't block bookmarking.*
7. **`SessionDescriptor` type unification with `cotail-session-report`.** The
   epic defines a layered live `SessionInfo`; this design defines a snapshot
   `SessionDescriptor`. They should share field names and types where they
   overlap. *Recommendation: extract shared `SessionNavigationalFields`
   interface that both extend.*
8. **Should we auto-record a save-point on `cotail` commands that "matter"?**
   E.g., every `cotail search` could optionally tag the active session as
   `searched-from`. *Recommendation: no auto-recording in this ticket —
   user-driven only — but keep the door open via the producer pattern.*

## Out of scope (future tickets)

- Read-side: `cotail bookmarks ls / search / rm`, `cotail savepoints tree`.
- Auto-producers: `cotail watch` for fork-point/compaction-boundary creation.
- Cross-session narratives UI (`cotail tree <rootId>`).
- Snapshotting reasoning, tool calls, or patches (Layer 2 slots are reserved).
- Migrating `src/savepoint/` into a published plugin package.
- CLI framework migration (gunshi / effect).
- Type unification PR with the `cotail-session-report` epic (separate ticket).

## References

- [`draft0.glm52.md`](draft0.glm52.md) — the preceding bookmarks-only framing
  this design widens.
- [`/src/opencode/session-info.ts`](/src/opencode/session-info.ts) — the
  `SessionInfo` shape `SessionDescriptor` shares fields with.
- [`/src/opencode/source.ts`](/src/opencode/source.ts) — the v1/v2 `Source`
  abstraction, to extend with `latestTextByRole`.
- [`.design/v2.md`](/design/v2.md) — v2 `fork_session_id` / `fork_message_id`
  columns beyond v1's `parent_id`.
- [`opencode-history.md`](file:///home/rektide/archive/doc/opencode-history.md) —
  schema reference.
- `cotail-session-report` epic in `.beads/issues.jsonl` — the layered live
  `SessionInfo` to share types with.
- [`turso sdk-experimental MANUAL`](file:///home/rektide/archive/tursodatabase/sdk-experimental/MANUAL.md) —
  `resolve()` API.
