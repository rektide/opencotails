---
type: Design
title: "cotail Pointer — unifying primitive for session-addressed records (draft2)"
description: "Revised design focused on a `Pointer` primitive that the existing `search`, `history`, and `get-session` commands already produce in ad-hoc forms. Bookmark becomes a Pointer + Intent + optional ContentSnapshot, stored via a backend. Listing ships (global + per-project). Scope deliberately tight — the broader save-point / future-producer expansion is split into a sibling applications doc."
resource: /home/rektide/src/opencoattails/.design/bookmarks/draft2.glm52.md
tags: [cotail, cli, pointer, bookmark, unify, listing]
status: draft
generated: { by: agent:glm-5.2, at: 2026-08-04T00:00:00Z }
sources:
  - id: draft0
    resource: file:///home/rektide/src/opencoattails/.design/bookmarks/draft0.glm52.md
    title: "first draft — bookmarks-only, flat record"
  - id: draft1
    resource: file:///home/rektide/src/opencoattails/.design/bookmarks/draft1.glm52.md
    title: "second draft — over-expanded into a general save-point kind system (rolled back here)"
  - id: existing-commands
    resource: file:///home/rektide/src/opencoattails/src/commands/
    title: "current search/history/get-session — each returns bespoke shapes, all are really Pointer + data slots"
  - id: session-table
    resource: sqlite://~/.local/share/opencode/opencode.db
    title: "live DB: 2205 sessions, 473 distinct project directories"
---

# `cotail Pointer` — unifying primitive (draft2)

## What changed since draft1

draft1 expanded aggressively into a `kind`-discriminated save-point system with
14 enumerated future applications. The user pushed back:

> "i don't think you really did the right thing with savepoints? don't we have
> some existing capabilities here that are somewhat similar? what about
> history? isn't that the same general spirit? i'm trying to find unifying
> themes here, primitives, that help laterally. maybe just `Pointer` is the
> idea? … it was the history and search that i meant by where could we use
> this: both are kind of returning a pointer of some kind. your other ideas
> are very interesting and i want a separate design for capturing them but
> this is NOT the place for this grand expansion: i'm trying to unify the
> codebase, not expand scope vastly."

This draft rolls back the sprawl. Two concrete asks added: **listing**
(global + per-project) and **capturing project directory**. Everything else is
in service of unification, not new feature surface.

The future-applications brainstorm (decision-point tags, fork-point
auto-marking, compaction boundaries, handoffs, etc.) moves to
[`applications.glm52.md`](applications.glm52.md), a sibling file. This doc
stays about the primitive + bookmarks + listing.

## The unifying observation

Every cotail command today **returns a Pointer dressed up as a bespoke type**:

| command | returns | what it really is |
|---|---|---|
| `search` | `SearchHit { id, slug, title, directory, created, updated, snippet? }` | Pointer + descriptor-ish fields + snippet |
| `history` | `SessionCounts { id, title, directory, slug, time_created, time_updated, messages_total, messages_recent }` | Pointer + descriptor-ish fields + counts |
| `get-session` | `SessionInfo { id, title, directory, slug, projectId, parentId, version, timeCreated, timeUpdated }` | Pointer + descriptor-ish fields |

Three types, all sharing `id`, `title`, `directory`, `slug`, plus time fields.
Each command queries for *some* of the same data and packs it into a different
shape. **That's the duplication a `Pointer` primitive dissolves.**

## `Pointer` — the core identity

A Pointer addresses a session (and optionally a moment within it). Nothing
else. It's the join key across every command.

```ts
// src/pointer/types.ts
export interface Pointer {
  sessionId: string;
  at?: PointInSession;     // absent when the Pointer addresses the whole session
}

export interface PointInSession {
  time?: number;           // epoch-ms — when in the session
  messageId?: string;      // optional, more precise (a specific message id)
}
```

For `search` / `history` / `get-session`, `at` is absent — they address whole
sessions. For `bookmark`, `at.time = Date.now()` records the moment the
bookmark was made (and `messageId` if we know the latest message at capture
time).

**Intentionally minimal.** No `rootSessionId`, no `parentSessionId` baked in
— those are *lookups* you fill from a Pointer, not part of the Pointer itself
(draft1's mistake was stuffing lineage into the core). The Pointer is the
**address**; lineage is one of many facts you can look up about that address.

## Data lookups — each its own type

Given a Pointer, you can fill in independent data slots. Each slot is a
separate type, resolved by a separate routine:

```ts
export interface SessionDescriptor {
  // navigational identity of the session the Pointer addresses
  sessionId: string;
  rootSessionId: string;             // derived by walking parent chain
  parentSessionId: string | null;
  title: string;
  directory: string;                 // **the project directory** — first-class for listing
  slug: string;
  projectId: string;
  version: string;                   // "v1" | "v2"
  timeCreated: number;
  timeUpdated: number;
  fork: {
    sessionId: string | null;
    messageId: string | null;
    time: number | null;
  };
}

export interface SessionCounts {
  messagesTotal: number;
  messagesRecent: number;            // within a cutoff, configurable
}

export interface ContentSnapshot {
  userMessage: string | null;        // truncated latest user prompt at Pointer.at
  assistantReply: string | null;     // truncated latest assistant reply, null mid-turn
  truncateMessage: number;
  truncateReply: number;
}

export interface SearchSnippet {
  text: string;                      // the matched snippet
  partType: string;                  // text | reasoning | tool
}

export interface Intent {             // bookmark-specific
  note: string | null;
  tags: string[];
}
```

**Important: `directory` is in `SessionDescriptor`.** It's the project
directory opencode stored on the session row — exactly the field the user
asked us to capture, and the natural filter key for per-project listing.
473 distinct directories on the live DB; `compfuzor` alone has 177 sessions.

## Composite — bundles Pointer + filled-in data

A single shape carrying whatever any command chose to populate:

```ts
export interface Composite {
  pointer: Pointer;                   // always
  descriptor?: SessionDescriptor;
  counts?: SessionCounts;
  content?: ContentSnapshot;
  snippet?: SearchSnippet;
  intent?: Intent;
}
```

Every command both **produces** and **consumes** Composites:

- `search` produces `{ pointer, descriptor (partial), snippet }` for each hit.
- `history` produces `{ pointer, descriptor (partial), counts }` per session.
- `get-session` produces `{ pointer, descriptor (full) }`.
- `bookmark` produces `{ pointer, descriptor, content, intent }` and **stores** it.
- `bookmarks ls` (new) reads stored Composites and **renders** them, with
  optional re-lookup of `counts` for live context.

This is the "common routines" unification: each slot has one filler function,
each renderer accepts a Composite and reads whichever slots are present.

## Common routines

One function per slot — small, composable, the lateral primitives the user
asked for:

```ts
// src/pointer/resolve.ts
export function resolvePointer(input: {
  pid?: string; directory?: string; sessionId?: string;
}): Promise<Pointer>;                 // reuses get-session logic verbatim

// src/pointer/lookup.ts
export function lookupDescriptor(p: Pointer): SessionDescriptor | null;
export function lookupCounts(p: Pointer, cutoff?: number): SessionCounts | null;
export function captureContent(
  p: Pointer, opts: { truncateMessage: number; truncateReply: number;
                      noMessage?: boolean; noReply?: boolean; }
): ContentSnapshot | null;
export function searchSnippets(patterns: string[], opts: ...): Composite[];
export function listRecentPointers(opts: { since: number; directory?: string }): Composite[];
```

`resolvePointer` is literally today's `get-session` flow (PID → cwd → directory
match → session id) extracted into a reusable function — the existing command
becomes a thin renderer on top.

`lookupDescriptor` extends `getSessionById` in
[`/src/opencode/session-info.ts`](/src/opencode/session-info.ts) with two
derived fields: `rootSessionId` (recursive parent walk) and the `fork` sub-
object. Both are computed once per session and memoized in-process.

`captureContent` extends the `Source` abstraction
([`/src/opencode/source.ts`](/src/opencode/source.ts)) with
`latestTextByRole(sessionId, role)` (v1: `part` table; v2: `event` table) —
draft0/draft1 already worked out the SQL.

## Refactor strategy: additive, not big-bang

Existing commands keep working. New primitives land under `src/pointer/` and
`src/store/`; the existing `src/commands/*.ts` migrate one at a time:

1. **This ticket**: introduce `src/pointer/`, `src/store/`, ship
   `cotail bookmark` + `cotail bookmarks ls` using them. Existing commands
   untouched.
2. **Follow-up commit**: refactor `get-session` to use `resolvePointer` +
   `lookupDescriptor`, render from `Composite`. Behavior unchanged.
3. **Follow-up commit**: refactor `history` to use `listRecentPointers` +
   `lookupCounts`.
4. **Follow-up commit**: refactor `search` to use `searchSnippets`.

Each migration is small and independently reviewable. By the end, every
command shares the same primitives.

## Bookmark — a Composite producer + consumer

`cotail bookmark` is the producer. Resolution flow:

```
  resolvePointer (PID/session/directory args)
        │
        ▼
  Composite { pointer, descriptor: lookupDescriptor(pointer),
              content: captureContent(pointer, opts), intent: { note, tags } }
        │
        ▼
  store.save(composite)
        │
        ▼
  print: id-only (default) | full record --json
```

CLI:

```
cotail bookmark [options] [-- note]

Session resolution (inherited from get-session):
  [pid]                          positional opencode PID
  -s, --session <id>             use this session id directly
  -C, --directory <dir>          match by directory
  --db <path>                    opencode DB path (default: auto-discover)

Intent:
  -m, --message <text>           the note (alternative to positional after --)
  -t, --tags <list>              whitespace- and/or comma-separated

Content snapshot:
      --truncate-message <chars>  default 400
      --truncate-reply <chars>    default 400
      --no-message                skip user prompt capture
      --no-reply                  skip assistant reply capture

Store:
      --store <name>              turso | tsv (default: $COTAIL_STORE or turso)
      --tsv-path <path>           TSV file location (default: $COTAIL_STORE_PATH_TSV | $COTAIL_STORE_PATH | XDG)
      --turso-db <name>           Turso DB name (default: cotail-bookmarks)

Output:
      --json                      emit the full saved Composite as JSONL
      --id-only                   print only the new bookmark id (default)
  -h, --help
```

`note` via `-m` OR positional after `--`. If both, `-m` wins.

## Listing — global + per-project

The user explicitly asked for listing. Two scopes:

- **global** (default): every bookmark, across all projects.
- **per-project**: scoped to one `directory`.

```
cotail bookmarks ls [options]

Filtering:
      --project [<dir>]           scope to a project directory
                                   no value = current cwd's project (resolved via cwd match)
                                   with value = that directory
      --tag <name>                filter by tag (repeatable, OR semantics)
      --since <dur>               bookmarks since cutoff (24h, 7d, ISO date)
      --session <id>              bookmarks for a specific session
      --root <id>                 bookmarks whose session is under this rootSessionId

Output:
      --json                      JSONL — full Composite per line
      --tsv                       tab-separated
      --limit <n>                 default 100
  -h, --help
```

Default rendering is a table mirroring `history`'s shape, with bookmark-
specific columns:

```
ID              WHEN                PROJECT                          SESSION          TAGS                  NOTE
01J...          2026-08-04 14:02    /home/rektide/src/opencoattails  ses_04602d85...  decision-point        decided to use Turso
01J...          2026-08-04 13:30    /home/rektide/src/compfuzor      ses_0722be10...  bug, milestone        found the off-by-one
```

`PROJECT` is `descriptor.directory` — the project-directory capture the user
asked for, surfaced as a first-class listing column and a filter key. Per-
project mode filters on it:

```
$ cotail bookmarks ls --project            # current cwd's project
$ cotail bookmarks ls --project ~/src/compfuzor
```

The current-project resolution: take cwd, find the session whose `directory`
matches (today's `latestSessionByDirectory` logic), use that directory as the
filter. If no match, error with a hint to pass `--project <dir>` explicitly.

## Store interface (read + write)

draft0/draft1 deferred the read side; listing needs it, so it lands now:

```ts
// src/store/types.ts
export interface Store {
  readonly name: string;
  open(): Promise<void>;

  // write
  save(c: Composite): Promise<void>;

  // read
  list(filter: ListFilter): Promise<Composite[]>;

  close?(): Promise<void>;
}

export interface ListFilter {
  project?: string;            // session.directory match
  tags?: string[];             // OR semantics — any tag matches
  since?: number;              // createdAt >=
  sessionId?: string;
  rootSessionId?: string;
  limit?: number;
}
```

Two backends ship: **TSV** (zero-dep) and **Turso** (default, via
`~/archive/tursodatabase/sdk-experimental`). The Turso DB name is global
(`cotail-bookmarks`); per-project scoping is a `list()` filter, not a
per-project DB.

### Composite persistence

A Composite is persisted as one row. TSV flattens it; Turso stores JSON
columns per slot for query stability + schema-evolution headroom:

```sql
-- Turso schema
CREATE TABLE IF NOT EXISTS composites (
  id              TEXT PRIMARY KEY,         -- the bookmark id (ULID)
  created_at      INTEGER NOT NULL,         -- when the bookmark was saved
  pointer_json    TEXT NOT NULL,            -- { sessionId, at? }
  descriptor_json TEXT,                     -- SessionDescriptor or null
  content_json    TEXT,                     -- ContentSnapshot or null
  intent_json     TEXT,                     -- { note, tags } or null

  -- denormalized for filtered queries (mirror what's in the JSON):
  session_id      TEXT NOT NULL,
  root_session_id TEXT,
  directory       TEXT,                     -- descriptor.directory, for --project
  tags_json       TEXT                       -- '["decision-point"]', for --tag
);
CREATE INDEX IF NOT EXISTS c_created_at_idx ON composites(created_at);
CREATE INDEX IF NOT EXISTS c_directory_idx  ON composites(directory);
CREATE INDEX IF NOT EXISTS c_session_id_idx ON composites(session_id);
CREATE INDEX IF NOT EXISTS c_root_idx       ON composites(root_session_id);
```

`counts` and `snippet` slots are **never stored** — they're regenerable from
the live opencode DB, so `bookmarks ls` looks them up fresh on render. Only
`pointer`, `descriptor`, `content`, `intent` persist. This keeps the store
small and avoids stale counts.

TSV writes a header row + flat columns; the four persistent slots get columns,
the lookup-only slots don't:

```
id	created_at	session_id	at_time	root_session_id	parent_session_id	title	directory	slug	project_id	version	time_created	time_updated	fork_session_id	fork_message_id	fork_time	user_message	assistant_reply	truncate_message	truncate_reply	note	tags
```

## Module layout

```
src/
├── cli.ts                           (add: case "bookmark", case "bookmarks")
├── commands/
│   ├── bookmark.ts                  (NEW — producer)
│   ├── bookmarks.ts                 (NEW — listing consumer)
│   ├── search.ts                    (unchanged in this ticket; migrated later)
│   ├── history.ts                   (unchanged in this ticket; migrated later)
│   └── get-session.ts               (unchanged in this ticket; migrated later)
├── pointer/                         (NEW — the unifying primitive)
│   ├── types.ts                     (Pointer, PointInSession, Composite,
│   │                                  SessionDescriptor, SessionCounts,
│   │                                  ContentSnapshot, SearchSnippet, Intent)
│   ├── resolve.ts                   (resolvePointer — extracted from get-session)
│   ├── lookup.ts                    (lookupDescriptor, lookupCounts, captureContent)
│   └── search.ts                    (searchSnippets, listRecentPointers)
├── opencode/                        (existing — extended minimally)
│   ├── session-info.ts              (add: rootSessionIdOf(sessionId))
│   ├── source.ts                    (add: latestTextByRole on Source interface)
│   ├── v1/source.ts                 (implements latestTextByRole)
│   ├── v2/source.ts                 (implements latestTextByRole)
│   └── ...
└── store/                           (NEW — backend implementations)
    ├── types.ts                     (Store, ListFilter)
    ├── registry.ts                  (resolveStore)
    ├── tsv.ts                       (TsvStore)
    └── turso.ts                     (TursoStore)
```

The naming is deliberate: `pointer/` is the primitive, `store/` is
persistence. The `savepoint/` name from draft1 is gone — over-engineered.

## Open decisions

1. **Bookmark id format.** ULID (time-ordered, naturally sortable in TSV
   without a separate column) vs `crypto.randomUUID()`.
   *Recommendation: ULID — small dep, large listing win.*
2. **`bookmarks ls` vs flat `bookmarks --list`.** Plural-subcommand naming
   (`bookmark` = create, `bookmarks ls` = list) mirrors `git`/`gh` but
   introduces a sub-subcommand. Flat flag keeps the surface one-level.
   *Recommendation: plural-subcommand — leaves room for `bookmarks rm`,
   `bookmarks search` later without re-plumbing the dispatcher.*
3. **Project resolution for `--project` with no value.** Cwd → nearest
   session's directory (today's `latestSessionByDirectory`), or cwd → walk up
   looking for a `.git`/project marker?
   *Recommendation: session lookup (matches the existing primitive and the
   data we actually have); add a `.git`-walk fallback only if it proves
   clumsy.*
4. **Listing freshness.** Stored `descriptor.timeUpdated` goes stale. Should
   `bookmarks ls` re-look up `descriptor` live, or show the snapshot?
   *Recommendation: show snapshot by default (it's what the user bookmarked);
   add `--live` to refresh descriptor fields from the opencode DB.*
5. **Store refactor of existing commands now or later.**
   *Recommendation: later, as separate follow-up commits (one per command).
   This ticket only adds `pointer/`, `store/`, `bookmark`, `bookmarks ls`.*
6. **`tags` filter semantics.** Multiple `--tag` flags = OR (any matches) or
   AND (all required)?
   *Recommendation: OR by default; add `--tag-all` for AND if needed later.*

## Out of scope (deferred)

- Refactoring `search` / `history` / `get-session` onto `Composite` —
  follow-up commits.
- `bookmarks rm`, `bookmarks search`, `bookmarks edit`.
- A `cotail bookmarks tags` vocabulary browser.
- Any producer other than the `bookmark` command. The future-applications
  brainstorm ([`applications.glm52.md`](applications.glm52.md)) is captured
  separately and explicitly **does not** gate this design.
- Migrating `src/store/` to a published plugin package.
- CLI framework migration (gunshi / effect).

## References

- [`draft0.glm52.md`](draft0.glm52.md) — first draft, flat bookmark record.
- [`draft1.glm52.md`](draft1.glm52.md) — over-expanded; rolled back.
- [`applications.glm52.md`](applications.glm52.md) — extracted brainstorm of
  future save-point-style producers; kept out of this design's scope.
- [`/src/commands/get-session.ts`](/src/commands/get-session.ts) — the
  resolution logic `resolvePointer` extracts.
- [`/src/commands/history.ts`](/src/commands/history.ts),
  [`/src/commands/search.ts`](/src/commands/search.ts) — commands that
  already return Pointer-shaped data in bespoke types.
- [`/src/opencode/session-info.ts`](/src/opencode/session-info.ts),
  [`/src/opencode/source.ts`](/src/opencode/source.ts) — existing primitives
  `lookupDescriptor` / `captureContent` extend.
- [`.design/v2.md`](/design/v2.md) — v2 `fork_session_id` / `fork_message_id`
  vs v1 `parent_id`.
- [`turso sdk-experimental MANUAL`](file:///home/rektide/archive/tursodatabase/sdk-experimental/MANUAL.md) —
  the `resolve()` API.
