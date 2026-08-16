---
type: Design
title: "cotail bookmark — capture a point in time"
description: "Design for a `cotail bookmark` subcommand that snapshots the active opencode session (latest user prompt + latest assistant reply, truncated) with an optional message and tags, persisted through a runtime-selectable backend (TSV file or Turso cloud DB)."
resource: /home/rektide/src/opencoattails/.design/bookmarks/draft0.glm52.md
tags: [cotail, cli, bookmark, store, turso, tsv]
status: draft
generated: { by: agent:glm-5.2, at: 2026-08-04T00:00:00Z }
sources:
  - id: cotail-get-session
    resource: file:///home/rektide/src/opencoattails/src/commands/get-session.ts
    title: "existing session-resolution command this feature extends"
  - id: cotail-session-info
    resource: file:///home/rektide/src/opencoattails/src/opencode/session-info.ts
    title: "canonical SessionInfo type"
  - id: turso-sdk-experimental
    resource: file:///home/rektide/archive/tursodatabase/sdk-experimental/README.md
    title: "Turso zero-config provisioning SDK (resolve → connect)"
  - id: opencode-history
    resource: file:///home/rektide/archive/doc/opencode-history.md
    title: "schema reference for session/message/part/event tables"
  - id: cotail-v2-design
    resource: file:///home/rektide/src/opencoattails/.design/v2.md
    title: "v1/v2 schema split — message vs session_message vs event"
---

# `cotail bookmark` — point-in-time session snapshot

## Situation

`cotail` today is read-only against opencode's live SQLite DB. Three subcommands
ship — `search`, `history`, `get-session` — and each is a hand-rolled parser
dispatched from `src/cli.ts`. `get-session` already solves "which session is
that opencode instance on right now?" via `/proc` + directory match or
`$OPENCODE_SESSION_ID`, returning the canonical `SessionInfo` block
(`src/opencode/session-info.ts:11`).

Nothing in cotail **writes** anywhere. There is no storage layer, no `--store`
abstraction, no second database.

## Problem

During a long agent session you hit moments worth marking — "here's where we
decided X", "here's where the bug turned out to be", "this is the prompt that
unlocked it". Today the only way to "save" that moment is to copy-paste the
session id somewhere, or rely on opencode's own `time_updated` to find it later.
Neither carries your *intent* (why this moment mattered), nor a snapshot of the
prompt/reply at the time, nor a tag you can filter on later.

We want a **bookmark**: a typed record, written to a **runtime-selectable
backend**, that captures:

- **when** it happened (timestamp)
- **what session** it was (resolved via the existing `get-session` machinery)
- **some of the message** — the latest user prompt, truncated (length configurable)
- **some of the reply** — the latest assistant reply, if one exists yet, truncated (length configurable)
- an optional free-form **note** from the user
- optional **tags** (whitespace- and/or comma-separated; e.g. `decision-point`)

Backends are **pluggable**: the default is Turso (via
`~/archive/tursodatabase/sdk-experimental`), with a TSV-file backend as the
zero-deps escape hatch. The same `--store` selector will be reused by future
cotail tools that need persistence — it is the seed of a cross-cutting store
abstraction, not a bookmarks-only knob.

## Goals

- `cotail bookmark` writes a bookmark to a configurable backend, fast.
- Two backends ship: **Turso** (default) and **TSV**.
- Backend is selected at run time via `--store <name>` / `$COTAIL_STORE`.
- Reuses the session-resolution logic from `get-session` verbatim — no fork.
- Captures a snapshot (truncated) of the latest user message + latest assistant
  reply at bookmark time, so the bookmark is *self-contained* even if the
  session is later deleted or compacted.
- Tags parse leniently: any mix of whitespace and commas.
- Truncation and message capture are **configurable** via flags (and defaults).

## Non-goals (for this design)

- **Listing/querying bookmarks.** This design is write-only. A `cotail bookmarks
  ls` / `cotail bookmarks search` follow-up is natural but separate.
- **Editing or deleting bookmarks.** Same — append-only for now.
- **Generalizing the store** into its own published package today. The
  interface is shaped so it *can* be extracted (and the `--store` flag already
  named generically), but it ships inside cotail until a second consumer
  arrives.
- **Migrating the CLI to a framework** (gunshi / effect). Explicitly deferred
  — see "Open packaging questions" below.
- **FTS over bookmark bodies.** Out of scope; that's the planned FTS phase.

## Open packaging questions (need a decision before build)

The user flagged that `--store` is "its own plugin" eventually, and asked
whether we're using gunshi or effect-cli. Neither is in place today — every
command is a hand-rolled parser (`src/commands/*.ts`). Three paths:

| option | pro | con |
|---|---|---|
| **A. stay hand-rolled** (recommended for this ticket) | zero churn, matches existing pattern in `cli.ts:18`, ships fastest | we keep hand-writing `parseArgs` per command; `--store` cross-cutting concern has nowhere natural to live |
| **B. migrate to `gunshi`** | AGENTS.mdpreferred CLI lib; subcommand routing, completion (`@gunshi/plugin-completion`), shared global flags like `--store` get a real home | one-time migration of three commands; pulls a dep |
| **C. migrate to effect `Cli`** | aligns with phase-2 effect.ts plan; schema-driven flags; integrated config | largest churn; pulls the effect stack early |

**Recommendation: A now, plan B for the *next* cross-cutting flag.** The
hand-rolled parser handles one more subcommand without strain, and B is best
done as a single dedicated migration commit once `--store` makes the
"cross-cutting global flag" pattern real. C should wait for the actual
effect.ts migration (Phase 2 in the README).

Where the `--store` flag lives under option A: in `src/cli.ts`, parsed
**before** subcommand dispatch, exported to subcommands via an env-shaped
context object (or simply re-read inside the bookmark command — it's the only
consumer today). When we move to gunshi, this becomes a global option.

## Abstract `BookmarkStore` interface

The runtime-pickable interface the user asked for. Lives at
`src/store/mod.ts` (new directory — the seed of the future plugin):

```ts
// src/store/types.ts
export interface BookmarkRecord {
  id: string;              // client-generated, ULID or crypto.randomUUID()
  createdAt: number;       // epoch-ms, client clock at bookmark time
  sessionId: string;       // resolved via get-session logic
  sessionTitle: string | null;
  sessionDirectory: string | null;
  userMessage: string | null;     // truncated snapshot, see "Capture"
  assistantReply: string | null;  // truncated snapshot, may be null mid-turn
  note: string | null;            // user-supplied free text
  tags: string[];                 // parsed, normalized (lowercase, deduped)
}

export interface BookmarkStore {
  readonly name: string;            // "turso" | "tsv" | ...
  open(): Promise<void>;            // idempotent; create schema/file if missing
  save(b: BookmarkRecord): Promise<void>;   // append-only
  close?(): Promise<void>;
}

export interface StoreOptions {
  // per-backend config — interpreted by the backend, opaque to the caller
  [key: string]: unknown;
}
```

Notes:

- **Append-only today.** No `get`/`list`/`delete` on the interface yet — they
  join when `cotail bookmarks ls` lands. This keeps the surface minimal and
  forces the read-side design to happen in its own ticket.
- **Schema is uniform across backends.** TSV is a flat file with one column per
  field; Turso is a single `bookmarks` table mirroring the same fields. A
  future `list`/`search` works against either.
- **Tags as `string[]`** in the record. TSV serializes them with a delimiter
  (see TSV backend); Turso gets a JSON column or a side table — JSON column is
  simpler and adequate at this scale.

### Registry

```ts
// src/store/registry.ts
import type { BookmarkStore } from "./types.ts";
import { TursoBookmarkStore } from "./turso.ts";
import { TsvBookmarkStore } from "./tsv.ts";

const stores: Record<string, () => BookmarkStore> = {
  turso: () => new TursoBookmarkStore(),
  tsv: () => new TsvBookmarkStore(),
};

export function resolveStore(name: string): BookmarkStore {
  const factory = stores[name];
  if (!factory) throw new Error(`unknown store backend: ${name}`);
  return factory();
}

export const DEFAULT_STORE = "turso";
export const AVAILABLE_STORES = Object.keys(stores);
```

This is intentionally a hard-coded map. A plugin-style dynamic registry
(`import(".../" + name + ".ts")`) is wasted indirection until a third backend
exists.

## Backend: TSV

The zero-dependency escape hatch. One file, append-only, header row written on
first open.

**Default location:** `$XDG_DATA_HOME/cotail/bookmarks.tsv` (resolved to
`~/.local/share/cotail/bookmarks.tsv` on Linux). Override via:

- `$COTAIL_STORE_PATH_TSV` — explicit path to the file (preferred, specific)
- `$COTAIL_STORE_PATH` — "intelligent" fallback used by *any* file-based
  backend; for TSV it points at the file directly

Precedence: `COTAIL_STORE_PATH_TSV` > `COTAIL_STORE_PATH` > XDG default.

**Format:** TSV with a header row. Columns mirror `BookmarkRecord`:

```
id<TAB>createdAt<TAB>sessionId<TAB>sessionTitle<TAB>sessionDirectory<TAB>userMessage<TAB>assistantReply<TAB>note<TAB>tags
0194ec50-...<TAB>1785649200341<TAB>ses_04602d85...<TAB>...<TAB>...<TAB>...<TAB>...<TAB>...<TAB>decision-point,important
```

Encoding rules:

- `tags` joined with `,` (no whitespace in tags — the input parser already
  split on whitespace/comma; on output we use a single delimiter).
- Newlines and tabs inside any field are escaped as `\n` / `\t`, and a literal
  `\` becomes `\\`. (A small, explicit escaper in `src/store/tsv.ts`; no
  third-party CSV lib at this scale.)
- `null` fields emitted as empty string.

**Concurrency:** append-only writes with `O_APPEND` (via `node:fs/promises`
`appendFile`). No locking — concurrent cotail processes appending to the same
file is rare and append-atomicity at small row sizes is adequate.

## Backend: Turso (default)

Uses [`@tursodatabase/sdk-experimental`](https://www.npmjs.com/package/@tursodatabase/sdk-experimental)
from `~/archive/tursodatabase/sdk-experimental`. The SDK auto-provisions on
first touch — call `resolve(name)` and you get back `{ url, authToken }` to
feed into `@tursodatabase/serverless`'s `connect()`. No dashboards, no manual
DB creation.

**Database name:** `cotail-bookmarks` — **global per-user** (one DB for all
projects). Configurable via `$COTAIL_STORE_TURSO_DB`.

**Required env (the SDK reads these directly):**

- `TURSO_API_TOKEN` — `turso auth api-tokens mint ...`
- `TURSO_ORG` — `turso org list`
- `TURSO_GROUP` — `turso group create cotail` (or reuse an existing one)

If any are missing, the command fails fast with a clear message pointing at
the TSV escape hatch: *"set `--store tsv` (or `$COTAIL_STORE=tsv`) to write
locally instead."*

**Schema** (created idempotently in `open()`):

```sql
CREATE TABLE IF NOT EXISTS bookmarks (
  id               TEXT PRIMARY KEY,
  created_at       INTEGER NOT NULL,
  session_id       TEXT NOT NULL,
  session_title    TEXT,
  session_directory TEXT,
  user_message     TEXT,
  assistant_reply  TEXT,
  note             TEXT,
  tags             TEXT NOT NULL DEFAULT '[]'   -- JSON array
);
CREATE INDEX IF NOT EXISTS bookmarks_created_at_idx ON bookmarks(created_at);
CREATE INDEX IF NOT EXISTS bookmarks_session_id_idx ON bookmarks(session_id);
```

`tags` as a JSON text column is adequate at this scale and avoids a join table.
If we ever want tagged search in SQL, a `bookmarks_tags(bookmark_id, tag)`
side table is the migration path; the `BookmarkStore.save` signature doesn't
change.

**Dependencies:** two new npm deps — `@tursodatabase/sdk-experimental` and
`@tursodatabase/serverless`. The SDK-experimental path in
`~/archive/tursodatabase/sdk-experimental` can be linked locally via
`pnpm install` with a `file:`-style dep for development, or pulled from npm
for release. AGENTS.md says "do not edit `package.json` directly" — use
`pnpm install @tursodatabase/sdk-experimental @tursodatabase/serverless`.

The SDK is **async** (`resolve()` returns a Promise, `connect()` returns an
async client). This forces `BookmarkStore.open` / `save` to be async — already
reflected in the interface above. The TSV backend is fast enough that the
async overhead is irrelevant.

## Configuration

Single source of truth for "which backend" and "where":

| env var | scope | meaning |
|---|---|---|
| `COTAIL_STORE` | global | backend name: `turso` (default) \| `tsv` |
| `COTAIL_STORE_PATH` | global | "intelligent" path — interpreted per backend. TSV: the file. (Turso: ignored today; could later point at a local libsql file.) |
| `COTAIL_STORE_PATH_TSV` | TSV-only | overrides `COTAIL_STORE_PATH` for the TSV backend |
| `COTAIL_STORE_TURSO_DB` | Turso-only | DB name (default: `cotail-bookmarks`) |
| `TURSO_API_TOKEN`, `TURSO_ORG`, `TURSO_GROUP` | Turso-only | read by the SDK itself |

CLI flag (highest precedence): `--store <name>`.

Precedence: `--store` > `$COTAIL_STORE` > built-in default (`turso`).

## CLI surface

```
cotail bookmark [options] [-- note]
cotail bookmark --help
```

`note` is positional text after `--` (so it can contain leading `-`), or via
`-m / --message`. If both, the flag wins. Optional.

```
Options (session resolution — inherited from get-session):
  [pid]                     positional opencode PID
  -s, --session <id>        use this session id directly
  -C, --directory <dir>     match by directory
  --db <path>               opencode DB path (default: auto-discover)

Options (bookmark-specific):
  -m, --message <text>      the note to attach (alternative to positional)
  -t, --tags <list>         tags, whitespace- and/or comma-separated
                            e.g. -t "decision-point, important milestone"
      --store <name>        backend: turso | tsv (default: $COTAIL_STORE or turso)
      --tsv-path <path>     override TSV file location (else $COTAIL_STORE_PATH_TSV / ...PATH / XDG)
      --turso-db <name>     override Turso DB name (default: cotail-bookmarks)

Options (snapshot capture — configurable truncation):
      --truncate-message <chars>   max chars of the user prompt to capture (default: 400)
      --truncate-reply <chars>     max chars of the assistant reply to capture (default: 400)
      --no-message                 don't capture the user prompt snapshot
      --no-reply                   don't capture the assistant reply snapshot

Output:
      --json                emit the saved bookmark record as JSONL
      --id-only             print only the new bookmark id
  -h, --help                show this help
```

### Tags parsing

`--tags` value is split on `/[\s,]+/`, trimmed, lower-cased, deduped, and
empties dropped. So all of these are equivalent:

```
--tags "decision-point, important"
--tags "decision-point important"
--tags "decision-point,important,"
```

→ `["decision-point", "important"]`

Tags are stored verbatim (no validation against a vocabulary) — anyone can
invent a tag at any time. A future `cotail bookmarks tags` (separate ticket)
could enumerate and rename them.

## Capture: snapshotting the prompt + reply

At bookmark time we want the **latest user prompt** and the **latest assistant
reply** (if any) from the resolved session, as plain text, truncated.

### Source of truth

This is exactly what `src/opencode/source.ts`'s `Source` abstraction already
routes around — `V1Source` reads the `part` table, `V2Source` reads the
`event` table. Today the `Source` interface only exposes `searchContent`. We
**extend** it with one new method:

```ts
// src/opencode/source.ts (extended)
export interface Source {
  readonly version: "v1" | "v2";
  searchContent(q: ContentQuery): SearchHit[];
  latestTextByRole(sessionId: string, role: "user" | "assistant"): string | null;  // NEW
}
```

Implementation sketch (V1, `part` table):

```sql
SELECT substr(json_extract(p.data, '$.text'), 1, ?) AS text
FROM part p
WHERE p.session_id = ?
  AND json_extract(p.data, '$.type') = 'text'
  AND EXISTS (
    SELECT 1 FROM message m
    WHERE m.id = p.message_id AND json_extract(m.data, '$.role') = ?
  )
ORDER BY p.time_created DESC LIMIT 1;
```

V2 mirrors it against `event` with `$.part.text` and the role carried on the
surrounding `session_message` (joined via `aggregate_id`). Details follow the
patterns already established in `src/opencode/v1/source.ts` and `v2/source.ts`.

**Both backends run read-only against the live opencode DB.** No writes to it.

### "Reply if available"

If the assistant hasn't replied yet (mid-turn bookmark), `latestTextByRole(sid,
"assistant")` returns null and `assistantReply` is stored as null. That's the
"if available" qualifier from the user — surfaced as a null field in the
record and an empty cell in TSV.

### Truncation

`--truncate-message` and `--truncate-reply` (defaults 400/400 chars) cap each
snapshot. A trailing `…` is **not** added by the capture layer — the field is
just truncated to N chars. Renderers (human output, future `bookmarks ls`) can
add visual ellipses; the stored record stays machine-usable. The `--no-message`
/ `--no-reply` flags skip capture entirely and store null.

## Flow

```
┌────────────────┐    ┌──────────────────┐    ┌────────────────┐
│ resolve active │───▶│ snapshot prompt +│───▶│ build          │
│ session        │    │ reply (v1 or v2) │    │ BookmarkRecord │
│ (get-session)  │    │ from opencode DB │    │ + note + tags  │
└────────────────┘    └──────────────────┘    └───────┬────────┘
                                                      │
                              ┌───────────────────────▼───────────────────────┐
                              │ resolveStore(--store / $COTAIL_STORE)         │
                              │   ├── "turso" → TursoBookmarkStore            │
                              │   └── "tsv"   → TsvBookmarkStore              │
                              └───────────────────────┬───────────────────────┘
                                                      │
                                                      ▼
                                              store.save(record)
```

## Module layout (proposed)

```
src/
├── cli.ts                          (add: case "bookmark")
├── commands/
│   └── bookmark.ts                 (new — arg parse, flow, render)
├── opencode/
│   ├── source.ts                   (extended: latestTextByRole)
│   ├── v1/source.ts                (implements latestTextByRole)
│   └── v2/source.ts                (implements latestTextByRole)
└── store/                          (new directory — future plugin home)
    ├── types.ts                    (BookmarkStore, BookmarkRecord, StoreOptions)
    ├── registry.ts                 (resolveStore, DEFAULT_STORE)
    ├── tsv.ts                      (TsvBookmarkStore + escape/unescape)
    └── turso.ts                    (TursoBookmarkStore via sdk-experimental)
```

## Open decisions (need your call)

1. **CLI framework.** Stay hand-rolled for this ticket (option A above), or
   migrate to gunshi/effect now? *Recommendation: A.*
2. **Bookmark id format.** `crypto.randomUUID()` (zero-dep, no ordering) vs
   ULID (lexicographically time-ordered, trivially sortable in TSV without a
   separate sort key). *Recommendation: ULID — small dep, big win for TSV
   natural sort order, and the `createdAt` field still carries precise time.*
3. **`COTAIL_STORE_PATH` semantics for Turso.** Today Turso has no file-system
   meaning, so `COTAIL_STORE_PATH` is silently ignored when `--store turso`.
   Alternatively we let it point at a local libsql file (using
   `@tursodatabase/serverless`'s file: URL mode) for an "offline Turso-shaped"
   dev mode. *Recommendation: ignore for now, document as ignored; revisit if
   someone wants local libsql.*
4. **`--store` global vs subcommand-local.** Today only `bookmark` consumes
   it. Should `--store` be parsed at the top-level dispatcher (so future
   commands inherit it for free) or just inside `bookmark` for now?
   *Recommendation: parse inside `bookmark` today, hoist to top-level when the
   second consumer arrives (avoids a half-built global config today).*
5. **Note: positional via `--`, or `-m` only?** Some CLIs reserve `--` for
   "end of options"; mixing it with a note that might start with `-` is the
   classic trap. *Recommendation: ship both — positional after `--` for
   ergonomics (`cotail bookmark -- "decided to use Turso"`), `-m` for
   scripting; if both, `-m` wins.*

## Out of scope (future tickets)

- `cotail bookmarks ls / search / rm` (read/edit side)
- `cotail bookmarks tags` (vocabulary management)
- Migrating to gunshi or effect `Cli`
- Extracting `src/store/` into a published plugin package
- Snapshotting more than the latest user+assistant pair (e.g. last N turns)
- Snapshotting tool/reasoning parts (only `type=text` captured today)
- Cross-device sync beyond what Turso gives you for free

## References

- [`/src/commands/get-session.ts`](/src/commands/get-session.ts) — the
  session-resolution flow this command reuses.
- [`/src/opencode/session-info.ts`](/src/opencode/session-info.ts) — the
  canonical `SessionInfo` shape.
- [`/src/opencode/source.ts`](/src/opencode/source.ts) — the v1/v2 `Source`
  abstraction to extend with `latestTextByRole`.
- [`turso sdk-experimental README`](file:///home/rektide/archive/tursodatabase/sdk-experimental/README.md)
  — the zero-config Turso provisioning SDK.
- [`turso sdk-experimental MANUAL`](file:///home/rektide/archive/tursodatabase/sdk-experimental/MANUAL.md)
  — `resolve()` API and options.
- [`opencode-history.md`](file:///home/rektide/archive/doc/opencode-history.md) —
  schema for `session` / `message` / `part` / `event`.
- [`.design/v2.md`](/design/v2.md) — why v1 `part` vs v2 `event` and the
  schema split this design has to span.
- [`.design/history-viewer/design.md`](/design/history-viewer/design.md) —
  template for this design doc's shape and the prior subcommand-introduction
  pattern.
