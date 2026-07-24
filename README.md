# opencotails

`cotails` (a play on "tail" + cute name) is like [`rg`](https://github.com/BurntSushi/ripgrep) but for opencode sessions. You give it words, it finds every opencode session where **all** those words appear somewhere in that session's message text.

opencode stores its full session history (messages, reasoning, tool calls, patches) in a single WAL-mode SQLite database with no FTS index and no built-in search. `cotails` reads that database directly and runs the tested multi-term `EXISTS`-subquery-per-term pattern against the `part` table's JSON `data` column.

> This is a **prototype**. It will be transformed into an [`effect.ts`](https://effect.website) project next. It uses plain `process.argv` parsing, no framework, and synchronous DB access.

## Usage

```sh
cotails <term> [term...] [options]
```

```
Options:
  --db <path>     Database path (default: auto-discover)
  --limit <n>     Max results (default: 50)
  --json          Output JSONL instead of human-readable
  --title-only    Search session titles only
  --no-snippet    Don't show text snippet
  --type <type>   Part type to search: text, reasoning, tool (default: text)
```

### Examples

```sh
cotails opencode journal          # sessions with both "opencode" and "journal"
cotails turso wal --json          # JSONL output
cotails --title-only compaction   # search titles only
cotails --type reasoning memory   # search model reasoning text
```

## How it works

`cotails` resolves the opencode database by:

1. `$OPENCODE_DB` env var if set
2. Otherwise globs `~/.local/share/opencode/opencode*.db` and picks the **newest by mtime**
3. Falls back to `~/.local/share/opencode/opencode-.db` (locally compiled build)

It opens the DB **read-only** via Node's built-in `node:sqlite` (`DatabaseSync`), then runs the `EXISTS`-subquery-per-term pattern from the search SQL doc — one correlated semi-join per term, each short-circuiting on the first match:

```sql
SELECT s.id, s.slug, s.title,
       datetime(s.time_updated/1000,'unixepoch') AS updated,
       substr((SELECT json_extract(p.data, '$.text') ... ), 1, 200) AS snippet
FROM session s
WHERE EXISTS (SELECT 1 FROM part p
              WHERE p.session_id = s.id
                AND json_extract(p.data, '$.type') = 'text'
                AND lower(json_extract(p.data, '$.text')) LIKE ?)
  AND EXISTS (...)   -- one per term
ORDER BY s.time_updated DESC LIMIT 50
```

Each term is bound as `'%term%'` (lowercased) so `LIKE` matches case-insensitively. The first matching part per session is surfaced as a preview snippet.

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

## Status

Prototype, to be transformed into an [`effect.ts`](https://effect.website) project. Plain `process.argv` CLI, synchronous I/O, no comments.

## Reference

- [`/home/rektide/archive/doc/opencode-history.md`](file:///home/rektide/archive/doc/opencode-history.md) — the canonical search SQL doc with tested queries, schema details, and the schema of `session` / `message` / `part` / `event` tables.
