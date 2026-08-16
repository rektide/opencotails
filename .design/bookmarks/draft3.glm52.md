---
type: Design
title: "cotail Pointer + lineage (draft3) — access-pattern-aligned types"
description: "Revised after feedback: drop the bespoke `SessionDescriptor`; extend the existing `SessionInfo` with direct row fields it was missing, and add a separate `SessionLineage` for the expensive derived bits. `forkPoint` is now an array (chain of ancestor hops), and a new `forkOffs` array lists sessions that forked off from this one. All field names and concepts aligned with (and cited to) canonical opencode v1/v2 declarations."
resource: /home/rektide/src/opencoattails/.design/bookmarks/draft3.glm52.md
tags: [cotail, cli, pointer, bookmark, lineage, session, schema]
status: draft
generated: { by: agent:glm-5.2, at: 2026-08-04T00:00:00Z }
sources:
  - id: draft2
    resource: file:///home/rektide/src/opencoattails/.design/bookmarks/draft2.glm52.md
    title: "preceding draft — introduced Pointer but glommed SessionDescriptor"
  - id: opencode-v2-session-schema
    resource: file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session.ts
    title: "canonical v2 `Session.Info` (effect Schema struct)"
  - id: opencode-v2-fork-boundary
    resource: file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session-fork.ts
    title: "canonical v2 `ForkBoundary` discriminated union (before | through)"
  - id: opencode-v2-session-sql
    resource: file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/sql.ts
    title: "canonical v2 drizzle `SessionTable` — every column on the row"
  - id: opencode-v2-session-from-row
    resource: file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/info.ts
    title: "canonical v2 row → Session.Info decoder (shows which columns map where)"
  - id: opencode-v2-projector
    resource: file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/projector.ts
    title: "where v2 sets parent_id vs fork_session_id at fork-event time"
  - id: opencode-v1-session-info
    resource: file:///home/rektide/archive/anomalyco/v1/packages/opencode/src/session/session.ts
    title: "canonical v1 `Session.Info` (parentID only, no fork boundary)"
  - id: cotail-session-report-epic
    resource: file:///home/rektide/src/opencoattails/.beads/issues.jsonl
    title: "existing epic defining layered live SessionInfo — this draft aligns with its layers"
---

# cotail Pointer + lineage (draft3)

## What's new since draft2

draft2 introduced `Pointer` + `Composite`, but the `SessionDescriptor` slot
was glommed — it duplicated the existing `SessionInfo` plus tacked on
expensive derived fields (rootSessionId, forkPoint.time), mixing two access
patterns in one type. The user pushed back:

> "is that all data that in fact is pretty direct from the sqlite session? it
> feels arbitrary & large. but maybe it makes sense? or is it just what you
> glommed together? ideally our interfaces match / break down by access
> patterns"

Plus concrete asks:

- **`forkPoint` should be an array** (the chain of ancestor hops with fork
  detail at each hop), not just the immediate one.
- **`forkOffs`** — sessions that forked off from this one (children). New.
- **Both go in `SessionLineage`.**
- **Align naming with upstream.** Use opencode's field names, not invented
  ones.
- **Audit for missing fields.** If anything on the row is absent, add it.
- **Cite canonical declarations** in the code and in this draft.

This draft does all of that. `SessionDescriptor` is gone; `SessionInfo` is
extended; `SessionLineage` is the new derived-only type with `forkPoint[]`
and `forkOffs[]`.

## Canonical sources (the source of truth)

Cited once here, referenced throughout. All opencode paths are in
`~/archive/anomalyco/`:

| concept | canonical location |
|---|---|
| v2 `Session.Info` type | [`v2/packages/schema/src/session.ts:28-49`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session.ts) |
| v2 `Session.ForkBoundary` (before \| through) | [`v2/packages/schema/src/session-fork.ts:6-9`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session-fork.ts) |
| v2 SQL columns (`SessionTable`) | [`v2/packages/core/src/session/sql.ts:24-65`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/sql.ts) |
| v2 row → `Session.Info` decoder | [`v2/packages/core/src/session/info.ts:16-58`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/info.ts) |
| v2 fork-event projector (sets `fork_session_id`, nulls `parent_id`) | [`v2/packages/core/src/session/projector.ts:208-224`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/projector.ts) |
| v1 `Session.Info` type (parentID only) | [`v1/packages/opencode/src/session/session.ts:224-244`](file:///home/rektide/archive/anomalyco/v1/packages/opencode/src/session/session.ts) |
| cotail live DB (v1 shape, 2205 sessions, 494 with parent_id) | `~/.local/share/opencode/opencode.db` |

## Direct-vs-derived audit

Every field against the session row, with cost:

### Direct row lookup (one indexed SELECT by `id`)

| field | v1 column | v2 column | notes |
|---|---|---|---|
| `id` | `id` | `id` | PK |
| `slug` | `slug` | `slug` | |
| `title` | `title` | `title` | nullable |
| `directory` | `directory` | `directory` | **the project directory** — first-class |
| `path` (subpath) | — | `path` | v2-only; relative path within directory |
| `projectId` | `project_id` | `project_id` | FK → project |
| `workspaceId` | — | `workspace_id` | v2-only |
| `version` | `version` | `version` | "v1" \| "v2" |
| `parentId` | `parent_id` | `parent_id` | continuation lineage (distinct from fork in v2!) |
| `forkSessionId` | — | `fork_session_id` | v2-only; explicit-fork parent |
| `forkBoundary` | — | `fork_boundary` (JSON) | v2-only; `{type, messageID}` |
| `agent` | — | `agent` | |
| `model` | — | `model` (JSON `{id, providerID, variant?}`) | |
| `cost` | — | `cost` (real) | running total |
| `tokensInput/Output/Reasoning/CacheRead/CacheWrite` | — | `tokens_*` | |
| `summaryAdditions/Deletions/Files/Diffs` | — | `summary_*` | git diff summary |
| `shareUrl` | `share_url` | `share_url` | |
| `revert` | `revert` | `revert` (JSON) | |
| `permission` | `permission` | `permission` (JSON) | |
| `metadata` | — | `metadata` (JSON) | free-form |
| `timeCreated` | `time_created` | `time_created` | |
| `timeUpdated` | `time_updated` | `time_updated` | |
| `timeCompacting` | `time_compacting` | `time_compacting` | |
| `timeArchived` | `time_archived` | `time_archived` | |
| `timeSuspended` | — | `time_suspended` | v2-only |

### Derived (separate lookups)

| field | how | cost |
|---|---|---|
| `rootSessionId` | recursive CTE walking `COALESCE(fork_session_id, parent_id)` up to a root | one indexed walk per session |
| `forkPoint[].time` | for each ancestor hop, look up the boundary message's `time_created` | one SELECT per hop |
| `forkOffs` | `SELECT … WHERE fork_session_id = ? OR parent_id = ?` | one indexed lookup |
| `forkOffs[].time` | per child, look up the boundary message's time | one SELECT per child |

The two patterns don't compose — `SessionInfo` is one access, `SessionLineage`
is several. They stay separate types.

## Parent vs fork: upstream is not what we assumed

The user assumed "parent and fork are the same thing." **In v1 yes; in v2 no.**
This is the most important schema finding in this round, and the draft
preserves the v2 distinction rather than papering over it.

### v1 ([`v1/.../session.ts:224-244`](file:///home/rektide/archive/anomalyco/v1/packages/opencode/src/session/session.ts))

```ts
export const Info = Schema.Struct({
  // …
  parentID: optional(SessionID),    // the only lineage field; overloaded
  // … no fork concept at the type level
})
```

v1's SQL has only `parent_id`. It is set both for continuations and for
forks — there's no way to tell which from the row.

### v2 ([`v2/.../schema/src/session.ts:28-49`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session.ts))

```ts
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),                              // continuation
  fork: Schema.Struct({
    sessionID: ID,
    boundary: ForkBoundary,                                  // explicit fork point
  }).pipe(optional),
  // …
})
```

v2 has **both**, with different meanings:

- **`parentID`** — set on a *continuation*: same thread of work, resumed
  later. No message-level boundary. The projector at
  [`projector.ts:66`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/projector.ts)
  sets `parent_id: info.parentID` for ordinary session creation.
- **`fork.sessionID` + `fork.boundary`** — set on an *explicit fork*: a new
  branch with a specific message as the fork point. The projector at
  [`projector.ts:208-214`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/projector.ts)
  sets `parent_id: null` **and** `fork_session_id: event.data.parentID`,
  `fork_boundary: event.data.boundary`.

`ForkBoundary` is a discriminated union
([`session-fork.ts:6-9`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session-fork.ts)):

```ts
export const Boundary = Schema.Union([
  Schema.Struct({ type: Schema.Literal("before"),  messageID: SessionMessage.ID }),
  Schema.Struct({ type: Schema.Literal("through"), messageID: SessionMessage.ID }),
])
```

`before` = the child branch starts *before* this message (child doesn't see
it). `through` = the child includes this message and then diverges.

### Implication for cotail

We **preserve** the v2 distinction in our types. v1 data will simply have
`forkSessionId: null` and `forkBoundary: null`, with `parentId` carrying the
overloaded meaning. Walking up the lineage uses
`COALESCE(forkSessionId, parentId)` so both lineages traverse.

The naming question for our types: stay with opencode's `parentID` /
`fork.{sessionID, boundary}` exactly? **Yes** — it's the least-surprise
choice for "align with upstream," and it preserves the distinction instead
of silently merging. The user's "parent.messageId and parent.time are both
good" maps cleanly onto `fork.boundary.messageID` and the boundary message's
time.

## Type design

### `SessionInfo` — extended (replaces draft2's `SessionDescriptor`)

Direct row fields only — one SELECT by id. Aligns with the existing
`cotail-session-report` epic's layers 1–7. The current type in
[`/src/opencode/session-info.ts:11`](/src/opencode/session-info.ts) is the
seed; this extends it.

```ts
// src/opencode/session-info.ts (extended)
export interface SessionInfo {
  // layer 1 — core identity (existing)
  id: string;
  title: string;
  directory: string;                  // the project directory; first-class for listing
  slug: string;
  projectId: string;
  parentId: string | null;            // continuation lineage (v1: overloaded; v2: distinct from fork)
  version: string;                    // "v1" | "v2"
  timeCreated: number;
  timeUpdated: number;

  // layer 5 — fork lineage (v2-only direct columns; null on v1)
  forkSessionId: string | null;       // v2: fork_session_id; v1: null
  forkBoundary: ForkBoundary | null;  // v2: fork_boundary; v1: null

  // layer 2 — run (v2-only direct columns; absent on v1)
  agent: string | null;
  model: { id: string; providerID: string; variant?: string } | null;

  // layer 3 — cost (v2-only direct columns)
  cost: number;
  tokens: {
    input: number; output: number; reasoning: number;
    cache: { read: number; write: number };
  };

  // layer 4 — vcs summary (v2-only direct columns)
  summary: {
    additions: number; deletions: number; files: number;
    diffs: unknown;  // FileDiff.LegacyInfo[] — opaque to cotail
  } | null;

  // layer 6 — share
  shareUrl: string | null;

  // layer 7 — lifecycle
  timeCompacting: number | null;
  timeArchived: number | null;
  timeSuspended: number | null;       // v2-only

  // v2-only row fields with no layer assignment yet
  workspaceId: string | null;
  path: string | null;                // subpath within directory
  metadata: Record<string, unknown> | null;
  revert: unknown | null;
  permission: unknown | null;
}

// matches opencode v2 ForkBoundary exactly
export type ForkBoundary =
  | { type: "before"; messageID: string }
  | { type: "through"; messageID: string };
```

Field names mirror upstream: `parentId` not `parent_id` (camelCase public
shape, snake_case DB columns, mapped in the query layer — already the
convention in `session-info.ts`). `forkSessionId` / `forkBoundary` keep the
v2 distinction rather than collapsing to "parent".

### `SessionLineage` — new, derived-only

Everything here is computed (walks + message lookups), nothing is a direct
row read. Separate type, separate slot on `Composite`, looked up lazily.

```ts
// src/opencode/session-lineage.ts (NEW)
export interface SessionLineage {
  rootSessionId: string;

  // chain of ancestor hops, self-first (immediate parent at [0], root at the end)
  forkPoint: ForkHop[];

  // sessions that forked off from this one
  forkOffs: ForkOff[];
}

export interface ForkHop {
  // the session we came from at this hop
  sessionId: string;                  // == COALESCE(child.forkSessionId, child.parentId)
  // whether this hop was an explicit fork (v2) or an overloaded parent_id (v1)
  kind: "fork" | "parent";
  // the boundary in the parent — present when kind == "fork", null otherwise
  boundary: ForkBoundary | null;
  // when the boundary message was created (looked up against the message table)
  time: number | null;
}

export interface ForkOff {
  // the child session that forked off
  sessionId: string;
  // boundary in *this* session where the child branched
  boundary: ForkBoundary | null;
  // when that boundary message was created
  time: number | null;
}
```

`forkPoint` is an array (per the user's ask) — the chain walking up from
self to root, with fork detail at each hop. The immediate parent's details
are at `forkPoint[0]`. v1 sessions populate `kind: "parent"` with null
boundary throughout; v2 sessions populate `kind: "fork"` with the boundary
when one exists.

`forkOffs` is the inverse — sessions whose `fork_session_id` (or v1
`parent_id`) is `this.session.id`. Same shape, since both describe "a fork
happened at this message in this session."

### SQL

Upward walk (self → root):

```sql
WITH RECURSIVE chain(
  id, parent_id, fork_session_id, fork_boundary, depth
) AS (
  SELECT id, parent_id, fork_session_id, fork_boundary, 0
  FROM session WHERE id = ?
  UNION ALL
  SELECT s.id, s.parent_id, s.fork_session_id, s.fork_boundary, c.depth + 1
  FROM session s
  JOIN chain c
    ON s.id = COALESCE(c.fork_session_id, c.parent_id)
  WHERE c.parent_id IS NOT NULL OR c.fork_session_id IS NOT NULL
)
SELECT * FROM chain ORDER BY depth;
```

Downward children (one indexed lookup):

```sql
SELECT id, fork_boundary, time_created
FROM session
WHERE fork_session_id = ? OR parent_id = ?
ORDER BY time_created;
```

Per-hop and per-child `time` is then a batched lookup against `message` (v1)
or `session_message` (v2) for the boundary message's `time_created`.

## Where this lands in `Composite`

draft2's slots stay; the only change is `descriptor` becomes plain
`SessionInfo`, and `lineage` is added as a peer slot:

```ts
export interface Composite {
  pointer: Pointer;                   // always
  info?: SessionInfo;                 // direct-row lookup (was "descriptor")
  lineage?: SessionLineage;           // NEW — derived walks; lazy
  counts?: SessionCounts;
  content?: ContentSnapshot;
  snippet?: SearchSnippet;
  intent?: Intent;                    // bookmark-only
}
```

A producer picks which slots to fill based on what it actually needs. Most
producers (`search`, `history`, `get-session`, `bookmark`) fill `info` and
stop — `lineage` is for consumers that explicitly care about ancestry
(`bookmarks ls --root <id>`, a future `cotail tree`).

## Citing canonical declarations from code

The user asked for our code to reference opencode's declarations "for future
use." Concretely:

- Each field on `SessionInfo` carries a JSDoc comment with the upstream
  column path and the canonical type cite, e.g.:
  ```ts
  /** v2 `fork_session_id`. Set when this session was explicitly forked from
   * another; distinct from `parentId` (continuation). Null on v1.
   * @see opencode v2 SessionTable — packages/core/src/session/sql.ts:34
   * @see opencode v2 Session.Info.fork.sessionID — packages/schema/src/session.ts:32 */
  forkSessionId: string | null;
  ```
- `ForkBoundary` is **literally** the upstream type, re-declared (with a
  comment pointing at the canonical) rather than re-implemented from
  scratch. If opencode ever ships a npm package with the schema exported, we
  import it; today, re-declaration with a `@see` is the next-best thing.
- `fromRow()` (the row → `SessionInfo` mapper) mirrors
  [`v2/.../session/info.ts:16-58`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/info.ts)
  structurally, and the comments say so.

## What's gone from draft2

- **`SessionDescriptor`** — deleted. Its direct-row parts fold into the
  extended `SessionInfo`; its derived parts move to `SessionLineage`. One
  type per access pattern.
- **The `fork: { sessionId, messageId, time }` sub-object on the descriptor**
  — replaced by upstream-aligned `forkSessionId` + `forkBoundary` (direct)
  on `SessionInfo`, and the `forkPoint[]` / `forkOffs[]` arrays (derived) on
  `SessionLineage`.

## Open decisions

1. **v1/v2 fork conflation.** When a v1 session has `parent_id` set, do we
   surface it as `parentId` only (truthful — v1 has no fork concept) or
   *also* mirror it into `forkSessionId` (convenient for lineage queries
   that don't want to COALESCE)?
   *Recommendation: parentId only, and let the recursive CTE COALESCE.
   Mirroring lies about what v1 knew.*
2. **`forkPoint` ordering.** Self-first (`[parent, grandparent, …, root]`)
   or root-first (`[root, …, grandparent, parent]`)?
   *Recommendation: self-first — matches "walk up from here" mental model
   and makes `forkPoint[0]` the immediate parent (the most-asked entry).*
3. **Cap on chain depth.** Recursive CTEs can loop on malformed data.
   *Recommendation: hard cap at 100 hops (well beyond any real session
   tree), break with a stderr warning rather than throw.*
4. **Eager or lazy `time` lookups in lineage.** The boundary-message time
   lookups can be batched (one `IN (?)` query per `forkPoint[]`/`forkOffs[]`
   fill) or done per-hop.
   *Recommendation: batched — single round-trip per direction.*
5. **Cost/token fields on `SessionInfo`.** These change every turn. Snapshot
   them at bookmark time, or always re-lookup live?
   *Recommendation: snapshot at bookmark time (it's a frozen point-in-time
   record), re-lookup live for `--live` listing (draft2 already proposed
   this for descriptor freshness).*
6. **Field-name casing.** Public TS shape stays camelCase; DB access layer
   maps snake_case ↔ camelCase (existing convention in `session-info.ts`).
   `messageID` stays upper-case ID in the `ForkBoundary` subtype to match
   upstream exactly.
7. **Adopt `cotail-session-report` epic's layer vocabulary.** The epic
   already named layers 1–8. The extended `SessionInfo` here implements
   layers 1–7; layer 8 (live HTTP) is out of scope for cotail today.
   *Recommendation: yes — reference the epic from `SessionInfo`'s top
   comment so future work has a stable map.*

## Out of scope (unchanged from draft2 + applications doc)

- Refactoring existing commands onto `Composite` — follow-up commits.
- Other producers beyond `bookmark` — see
  [`applications.glm52.md`](applications.glm52.md).
- CLI framework migration.
- `bookmarks rm` / `search` / etc.

## References

- [`draft2.glm52.md`](draft2.glm52.md) — preceding draft; this one tightens
  its `SessionDescriptor` per access-pattern feedback.
- [`draft0.glm52.md`](draft0.glm52.md), [`draft1.glm52.md`](draft1.glm52.md),
  [`applications.glm52.md`](applications.glm52.md) — full history.
- [`/src/opencode/session-info.ts`](/src/opencode/session-info.ts) — the seed
  type this draft extends.
- [`v2/packages/schema/src/session.ts`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session.ts) —
  canonical `Session.Info`.
- [`v2/packages/schema/src/session-fork.ts`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session-fork.ts) —
  canonical `ForkBoundary`.
- [`v2/packages/core/src/session/sql.ts`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/sql.ts) —
  canonical `SessionTable`.
- [`v2/packages/core/src/session/info.ts`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/info.ts) —
  canonical row decoder.
- [`v2/packages/core/src/session/projector.ts`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/projector.ts) —
  where fork events set `fork_session_id` and null `parent_id`.
- [`v1/packages/opencode/src/session/session.ts`](file:///home/rektide/archive/anomalyco/v1/packages/opencode/src/session/session.ts) —
  canonical v1 `Session.Info` (parentID only).
- `cotail-session-report` epic in `.beads/issues.jsonl` — the layered
  `SessionInfo` definition this draft aligns with.
