# opencotails

`cotails` (a play on "tail" + cute name) is like [`rg`](https://github.com/BurntSushi/ripgrep) but for opencode sessions. It builds a full-text-search index over opencode's session history and runs fast, scopable queries against it.

opencode stores its full session history (messages, reasoning, tool calls, patches) in a single WAL-mode SQLite database with **no FTS index and no built-in search**. Direct `LIKE` scans work (~5s on a 4.8 GB database) but are painful for repeated or interactive use. `cotails` solves this with a two-phase architecture: **index** opencode's content into a Turso FTS5 database, then **search** that index in milliseconds.

> **Status:** prototype. The current implementation does direct regex searches against the live opencode DB (phase 0). The FTS indexing architecture below is the goal. It will be transformed into an [`effect.ts`](https://effect.website) project next.

## Usage (current prototype — direct regex search)

```sh
cotails <pattern> [pattern...] [options]
```

Terms are matched as **case-insensitive regular expressions** (AND'd together: a session must match every pattern). Matching runs as a `LIKE`-style scan over the live opencode DB via a JS-regex function registered with `node:sqlite`.

```
Options:
  --db <path>      Database path (default: auto-discover)
  --limit <n>      Max results (default: 50)
  --json           Output JSONL instead of human-readable
  --title-only     Search session titles only
  --no-snippet     Don't show text snippet
  --type <type>    Part type to search: text, reasoning, tool (default: text)
  -F, --fixed-strings   Treat patterns as literal strings, not regex
  -s, --case-sensitive  Match case sensitively (default: case-insensitive)
```

### Examples

```sh
cotails opencode journal          # sessions matching "opencode" and "journal"
cotails opencode 'event.*v2'      # "opencode" AND regex "event...v2"
cotails turso wal --json          # JSONL output
cotails --title-only compaction   # search titles only
cotails --type reasoning memory   # search model reasoning text
cotails 'foo.bar' -F              # literal "foo.bar" (no regex)
cotails OpEnCoDe                  # case-insensitive by default
```

## Planned CLI (FTS index)

```
cotails index [options]           # build/update the FTS index from opencode's DB
cotails search <query> [options]  # FTS search against the index (default subcommand)
cotails status                    # show index coverage and freshness
```

### `cotails index`

Reads opencode's SQLite database and builds a Turso FTS5 index. Scopable so you can index a subset:

```
cotails index                           # index everything (incremental: only new/changed)
cotails index --session <id>            # index one session
cotails index --directory ~/src/foo     # index sessions under a directory
cotails index --project <id>            # index sessions for a project
cotails index --since 7d                # index sessions updated in the last 7 days
cotails index --rebuild                 # drop and rebuild the entire index
```

Incremental indexing tracks which sessions have been indexed and their `time_updated`, so only new or changed content is re-indexed on subsequent runs.

### `cotails search`

Fast FTS5 search against the pre-built index — milliseconds instead of seconds:

```
cotails opencode journal                # FTS match, ranked by relevance
cotails "turso WAL" --json              # phrase query, JSONL output
cotails compaction --directory ~/src/bar  # scope to one directory's sessions
cotails "event sourcing" --session <id>   # scope to one session
cotails "tool call" --type tool           # search tool inputs/outputs only
cotails --limit 10                       # top 10 by bm25 relevance
```

### `cotails status`

```
sessions indexed:  2,687 / 2,687
parts indexed:     575,034
index size:        340 MB
last index run:    2 hours ago
stale sessions:    12 (updated since last index)
```

## Architecture

```mermaid
graph LR
    OC[opencode SQLite WAL db<br/>the source]
    subgraph "cotails"
        IDX[index phase<br/>read source, write FTS]
        SEARCH[search phase<br/>read FTS]
        INDEXDB[(Turso FTS index db<br/>owned by cotails)]
    end
    OC -->|short-lived read-only| IDX
    IDX -->|writes| INDEXDB
    SEARCH -->|reads| INDEXDB
```

Two databases, two roles:

| database | owner | engine | pattern |
|---|---|---|---|
| opencode's DB (`opencode-.db`) | opencode | SQLite WAL (C library) | short-lived read-only connections |
| cotails index DB (`~/.local/share/cotails/index.db`) | cotails | Turso (SQLite-compatible) | long-lived, read/write |

### FTS index schema (planned)

```sql
CREATE TABLE indexed_session (
    session_id   TEXT PRIMARY KEY,
    directory    TEXT,
    project_id   TEXT,
    title        TEXT,
    slug         TEXT,
    time_updated INTEGER,          -- from opencode, for incremental indexing
    indexed_at   INTEGER           -- when cotails last indexed this session
);

CREATE VIRTUAL TABLE parts_fts USING fts5(
    text,
    session_id   UNINDEXED,
    part_id      UNINDEXED,
    part_type    UNINDEXED,        -- text, reasoning, tool
    time_created UNINDEXED,
    content='parts_content',       -- external content table for space efficiency
    tokenize = 'porter unicode61'
);
```

Search uses FTS5 `MATCH` with bm25 ranking:

```sql
SELECT s.title, s.slug, snippet(parts_fts, 0, '<<', '>>', '...', 20) AS excerpt,
       bm25(parts_fts) AS rank
FROM parts_fts
JOIN indexed_session s ON s.session_id = parts_fts.session_id
WHERE parts_fts MATCH 'opencode AND journal'
  AND s.directory LIKE '~/src/opencode%'   -- scope
ORDER BY rank
LIMIT 20;
```

### Why a separate index database?

- **Speed.** FTS5 `MATCH` is O(matches) not O(all rows). A 575k-part database
  goes from ~5s (LIKE scan) to <50ms (FTS lookup).
- **No perturbation.** The index DB is owned by cotails. Reads and writes
  don't touch opencode's database at all.
- **Scoping.** Metadata columns (`directory`, `project_id`, `session_id`)
  enable filtered searches without re-reading opencode's schema.
- **Portability.** The index DB is a single file — copy it, move it, ship it.
- **Turso compatibility.** Built with SQLite FTS5, readable by the `turso`
  Rust crate or any SQLite tool.

## How the prototype works (direct LIKE search)

The current prototype resolves the opencode database by:

1. `$OPENCODE_DB` env var if set
2. Otherwise globs `~/.local/share/opencode/opencode*.db` and picks the **newest by mtime**
3. Falls back to `~/.local/share/opencode/opencode-.db` (locally compiled build)

It opens the DB **read-only** via Node's built-in `node:sqlite` (`DatabaseSync`), then runs the `EXISTS`-subquery-per-term pattern — one correlated semi-join per term, each short-circuiting on the first match:

```sql
SELECT s.id, s.slug, s.title,
       datetime(s.time_updated/1000,'unixepoch') AS updated,
       substr((SELECT json_extract(p.data, '$.text') ... ), 1, 200) AS snippet
FROM session s
WHERE EXISTS (SELECT 1 FROM part p
              WHERE p.session_id = s.id
                AND json_extract(p.data, '$.type') = 'text'
                AND re(?, json_extract(p.data, '$.text')))
  AND EXISTS (...)   -- one per term
ORDER BY s.time_updated DESC LIMIT 50
```

Each term is bound as a JS regex pattern and matched by a custom `re(pattern, string)` function registered with `DatabaseSync#function()`. The function compiles with the `i` flag by default (case-insensitive), or no flags under `-s`/`--case-sensitive`; compiled regexes are cached by pattern. Under `-F`/`--fixed-strings`, regex metacharacters in the term are escaped so it matches literally. The first matching part per session is surfaced as a preview snippet.

### Text lives in `part.data`, not `message.data`

The readable text is **not** in the `message` table — only metadata (`role`, `model`, `tokens`) lives there. The words are in the `part` table's JSON `data` column, keyed by `$.type`:

| `type` | field | what it is |
|---|---|---|
| `text` | `$.text` | user prompts and assistant prose replies |
| `reasoning` | `$.text` | model chain-of-thought |
| `tool` | `$.state.input`, `$.state.output` | tool call args and results |

### V2 event fallback

If the `part` table doesn't exist (V2-only databases), `cotails` falls back to searching the `event` table with the path `$.part.text` / `$.part.type`, filtered to event type `message.part.updated.1`.

## Requirements

- **Node.js 22+** — uses the built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) module (`DatabaseSync`). No external npm packages, no native sqlite bindings. Run directly with `node opencotails.ts` (Node's TypeScript type-stripping handles the `.ts` source — no build step).
- **For the FTS index (planned):** the index database will use SQLite FTS5, readable by `node:sqlite`, the `turso` Rust crate, or any SQLite tool.

## Status

- **Phase 0 (done):** direct scan against the live opencode DB, matching terms as case-insensitive JS regex. Works, ~5s per query on a 4.8 GB database.
- **Phase 1 (next):** `cotails index` builds a Turso FTS5 index. `cotails search` queries it in milliseconds. Scopable by session, directory, project.
- **Phase 2:** transform into an [`effect.ts`](https://effect.website) project.

## Reference

- [`/home/rektide/archive/doc/opencode-history.md`](file:///home/rektide/archive/doc/opencode-history.md) — the canonical search SQL doc with tested queries, schema details, and the schema of `session` / `message` / `part` / `event` tables.
