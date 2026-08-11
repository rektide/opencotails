---
type: Design
title: cotail watch — terminal output & ranking lead
description: Design for a `cotail watch` command with two modes over one observation loop — a history-style emitted activity stream, and a maintained on-screen stacked rank of everything available — covering stream vs snapshot semantics, TTY/non-TTY, redraw, signals, ranking keys/ties, bounded vs all, JSON, and testability.
resource: /home/rektide/src/opencoattails/.design/watch/terminal-and-ranking0.ds4f.md
tags: [cotail, watch, terminal, tui, ranking, sqlite, stream, tail]
status: draft
generated: { by: model:opencode-go/deepseek-v4-flash, at: 2026-08-11T00:00:00Z }
sources:
  - id: history-command
    resource: /src/commands/history.ts
    title: Existing history command (table/json/tsv renderers, since/directory/limit args)
  - id: count-active-sessions
    resource: /src/opencode/session.ts
    title: Existing session sweep SQL (time_updated cutoff, message+session_message sums)
  - id: db-discovery
    resource: /src/opencode/db.ts
    title: discoverDb / openReadOnly / registerRegex helpers
  - id: format-module
    resource: /src/format.ts
    title: TTY-gated color palette and table renderer
  - id: v2-design
    resource: /home/rektide/src/opencoattails/.design/v2.md
    title: opencode v2 impact (session_message, seq, extra session columns)
  - id: fab-readme
    resource: /home/rektide/src/opencode-session-fab/README.md
    title: opencode-session-fab CDC engine — wake mechanics, cursor correctness, first_seen
  - id: occ-cli
    resource: /home/rektide/src/opencode-session-fab/crates/occ/src/main.rs
    title: occ CLI — activity/tail/journal command shapes, Since::Now/Rowid/Beginning
  - id: occ-render
    resource: /home/rektide/src/opencode-session-fab/crates/occ/src/render.rs
    title: occ LineRenderer — one-line-per-change firehose renderer
  - id: multiview-readme
    resource: /home/rektide/src/opencode-multiview/README.md
    title: opencode-multiview — inline/fullscreen rollup of recent session activity
  - id: history-doc
    resource: /home/rektide/archive/doc/opencode/history.md
    title: Canonical opencode schema + SQL doc; data_version caveat for live modes
---

# `cotail watch` — Terminal Output & Ranking Lead

## Wave note

This is a `terminal-and-ranking` wave document (suffix `0`, model `ds4f`): the
output/UX lead for the `watch` command. It assumes the "two modes" framing —
**history-style emitted activity** and a **maintained on-screen stacked rank of
everything available** — and works out, end to end, what observing "now" from
the live SQLite DB means, how the two products share one observation loop, and
how each renders across TTY, pipe, and JSON. It deliberately covers the
input/poll/emit core as a *seam* (a testable engine) and focuses concrete
decisions on terminal behavior, ranking, and output contracts. It does not
cover index/FTS phases, nor command internals beyond the shapes needed to
render.

## Situation

`cotail` today is batch-only: `search`, `history`, and `get-session` each open
a read-only connection, run one query, print, close (`src/commands/history.ts:120-163`).
`history` already computes "sessions active within a window" via a
`time_updated >= cutoff` scan of the small `session` table, summing recent/total
message counts across both `message` and `session_message` (`src/opencode/session.ts:11-39`)
— safe to sum because v1/v2 content never overlaps per session (`.design/v2.md`).

The new `watch` command turns that one-shot query into a loop. Verified against
the live DB (`opencode-local.db`, 5,254 sessions, 288k `session_message`, 1.2M
`part`, **0 rows in `event`**):

- `PRAGMA data_version` is queryable through `node:sqlite` and changed 2 → 3
  within 4 s of idle watching while opencode wrote — a working change gate.
- `fs.watch` on the DB's parent directory saw 283 `-wal` change events in 5 s —
  a working wake-up. (SQLite commits touch the WAL; inotify on the dir catches
  sidecar churn, not just the main file.)
- `session` has **no index on `time_updated`** (indexes: PK, `project`, `parent`,
  `workspace`), but the table is small; a full scan per poll is sub-ms.
- `session_message` has `(session_id, time_created, id)` and standalone
  `time_created` indexes — cheap per-session recency counts for velocity ranks.
- **`session.time_updated` ties exist**: 59 sessions share one timestamp, 37
  share another. `ORDER BY time_updated DESC` alone is **not** a stable total
  order; ranking must tie-break deterministically.
- The **`event` journal is empty on this install** — a rowid-cursor journal
  tailer (the fab approach) would emit nothing. The session-sweep is the
  portable observation source; `event` is a future acceleration, not a base.

Two prior tools bracket the design space:

- **`occ` (opencode-session-fab)** — a Rust CDC CLI with `activity` (one-line
  firehose), `tail`, `journal`, `sessions` (`crates/occ/src/main.rs:34-99`).
  Its wake loop is: inotify on the parent dir → debounce (~25 ms) →
  `PRAGMA data_version` gate → safety-net poll (~1.5 s) (`README.md` §Wake-up).
  Its correctness lesson is directly portable: cursor + overlap + content
  dedupe, and `first_seen` (first sighting by *this* observer) rather than
  trusting "created" (`README.md` §Correctness).
- **`om` (opencode-multiview)** — an aspirational rollup: "a rollup of recent
  status and activity", inline and fullscreen, `-n` count, `-c` current project,
  `-1` oneshot, `-r` recent-changes-only (`README.md`). Its `src/main.rs` is
  mostly a stub (`todo!()` for fullscreen/json), so it is prior *intent*, and
  the shape to beat rather than copy.

The `watch` command is cotail's answer: **one poll loop, two renders** — a
flowing line stream and a maintained ranked screen.

## Thesis

`watch` is one observation loop with two render products over the same
observation events. The loop owns *change detection*: a cursor over
`session.time_updated`, gated by `PRAGMA data_version`, woken by filesystem
watches, debounced, with a safety-net poll. Each observation yields a small
list of **changed sessions** (created / updated). From those, two independent
renderers consume:

1. **stream** — emit one line (or JSON object) per change, oldest→newest,
   appended forever. This is `tail -f` semantics over session activity.
2. **rank** — fold the changed sessions back into a full **universe** of
   sessions, re-rank the universe by a key, and repaint a stacked on-screen
   view. This is snapshot semantics, refreshed.

The loop is source-neutral and testable: an engine that, given a DB, poll
cadence, a clock, and a wake source, produces `ChangeEvent[]`; renderers and
rankers are pure functions over those events plus a universe snapshot. This
splitting is what makes the terminal mechanics testable without a TTY and the
ranking testable without a loop.

Two consequences:

- **Stream is delta-oriented, rank is state-oriented.** Stream emits what
  happened *since the cursor*. Rank computes *everything that is* and how it
  orders. The rank mode never "replays" — it re-sorts the universe each tick.
- **The loop must not read message bodies.** A "what changed?" sweep over a
  1.2M-row `part` table is a multi-GB scan; the fab README's warning — "no
  index on `part.time_updated` … don't do that" — applies verbatim. Activity
  detection is a tiny `session` scan plus, only where the rank key requires it,
  cheap per-session index range-scans on `session_message`.

## Domain model and vocabulary

- **Observation** — one poll cycle that detected database change.
- **ChangeEvent** — `{ kind: "create" | "update", session, db, at }`, the unit
  the stream emits. `create` = first sighting by this observer; `update` =
  subsequent sightings (`first_seen` semantics from fab).
- **Universe** — the set of sessions eligible for ranking: `time_archived IS
  NULL`, minus nothing else unless a scope (`--since`, `--directory`) prunes
  it. "Everything available".
- **Rank** — a total order over the universe: a key expression plus a
  deterministic tie-breaker, so equal keys never flip row order between polls.
- **Frame** — the rendered model of one rank refresh (rows, header, footer,
  width). Rendering is pure: `renderFrame(frame) → string`.
- **Cursor** — the last observed `time_updated` watermark. `>=` with a
  per-id dedupe, not bare `>` (ties: fab's overlap lesson, live-data tie
  measurements).
- **Wake source** — anything that tells the loop "maybe dirty": fs events,
  a timer, a manual `tick()`. The engine accepts any.

## The observation loop

### Poll model

```ts
interface WatchEngineOptions {
  db: DatabaseSync;          // long-lived read-only connection
  wake: AsyncIterable<unknown> | EventSource; // fs.watch, timer, or injected
  pollIntervalMs: number;    // safety-net poll (~1500)
  debounceMs: number;        // coalesce wake bursts (~25)
  overlapMs: number;         // re-read tail for timestamp skew (~3000)
  now: () => number;         // injectable clock
}
```

Each cycle:

1. **Gate.** `PRAGMA data_version`. Unchanged → return. Changed → continue.
   This makes idle ticks cost one pragma, touching no table (occ README §Wake-up).
2. **Sweep.** `SELECT id, slug, title, directory, version, time_created,
   time_updated FROM session WHERE time_archived IS NULL AND time_updated >=
   cursor − overlap ORDER BY time_updated ASC, id`. Full scan of the tiny
   session table; the `ORDER BY … ASC` keeps the stream's natural order.
3. **Dedupe & emit.** For each row, skip if `(id, time_updated)` already
   emitted (overlap re-read); else emit `create` (new id) or `update`.
4. **Advance.** `cursor = max(time_updated)` **only after the equal-cursor
   rows are drained**, so a new session stamped with the same ms as the
   watermark is not missed on the next poll.
5. **Remove detection (rank only).** Compare seen ids vs current universe; a
   vanished id (archived/deleted) drops out of the next frame. For stream,
   optionally emit a `- archived` line.

Correctness note, recorded the way fab records its: the timestamp is
computed by opencode *before* commit, so under write contention a row can
appear with `time_updated` equal to rows already observed. The `overlapMs`
re-read plus the `(id, time_updated)` dedupe absorbs that skew; the dedupe set
must be pruned (drop ids older than the cursor's age) or it grows with the
universe.

### Wake sources (Node, zero-dep)

- `fs.watch(dbDir)` — the dir, filtered to paths starting with the db basename
  (matches `-wal`/`-shm` churn; the fab README's directory-not-files rationale
  is about sidecar lifecycle — exactly the Node behavior verified above).
- `PRAGMA data_version` — the correctness gate, not a wake. Verified through
  `node:sqlite`.
- Safety-net `setInterval` (~1.5 s) — catches fs.watch drops (queue overflows,
  NFS) and re-renders stale ages.
- In tests, an injected `tick()` replaces all three.

### Cursor start positions

| start | meaning | CLI |
|---|---|---|
| now | watch only future activity | default for stream |
| since | backfill sessions with `time_updated >= cutoff` | `--since <dur>` (reuse `parseSince`, `src/args.ts:16`) |
| backfill N | backfill the N most recent sessions | `--backfill <n>` (occ `tail -n` parity) |
| 0 | emit every session as created | `--from-beginning` (diagnostic; not in default surface) |

`--since` and `--backfill` compose: backfill = sessions active since cutoff,
capped at N, emitted oldest→newest, then live.

## CLI surface

One command, two modes. Mode is a flag so both are expressible in either
terminal context, with a TTY-sensible default:

```sh
cotail watch [--mode stream|rank] [options]
```

**Default mode: `rank` when stdout is a TTY, `stream` otherwise.** Rationale:
a terminal user wants the maintained screen; a piped user wants a flowing,
consumable stream. Explicit `--mode` always wins. (Alternative — require an
explicit mode positional, matching `history`'s "explicit subcommand" decision —
is listed under Open Questions.)

### Mode sketches

```
cotail watch --mode stream [--since <dur>] [--backfill <n>]
                           [--directory <path>] [--poll <ms>] [--json] [--db <path>]
cotail watch --mode rank   [--rank <key>] [--limit <n>] [--since <dur>]
                           [--directory <path>] [--poll <ms>]
                           [--json] [--oneshot] [--db <path>]
```

Common flags:

| flag | default | meaning |
|---|---|---|
| `--mode <stream\|rank>` | TTY→rank, else stream | product selection |
| `--db <path>` | auto-discover | shared with other commands |
| `--poll <ms>` | 1500 | safety-net poll / re-render cadence |
| `--since <dur>` | none | membership & backfill cutoff (`24h`, `7d`, …) |
| `--directory <path>` | none | membership substring scope |
| `--json` | off | JSONL output (see JSON/automation) |
| `--limit <n>` | rank: terminal rows; stream: 0 | bound the visible set |
| `--rank <key>` | `updated` | ranking key (rank mode) |
| `--oneshot` | off | print one frame (rank) or catch-up (stream), then exit |

## Stream mode — emitted activity

A flowing log. Each `ChangeEvent` prints one line:

```
19:02:11.284  ▸ stellar-panda   created  Review V2 migration invocation   /home/rektide/archive/anomalyco
19:02:13.097  · curious-knight  updated  v2-migration branch relationships  /home/rektide/archive/anomalyco
```

- `▸`/`·` = first-seen / updated (occ `LineRenderer` precedent,
  `crates/occ/src/render.rs:429-433`).
- Columns: time (wall-clock, ms), marker, slug, kind, title, directory.
  Title/directory truncated to terminal width; no truncation when piped.
- Backfill lines carry a leading dim `· backfill` marker so a reconnected
  user can distinguish history from live.
- **No redraw, no cursor movement, ever.** The stream appends. This is the
  mode that works everywhere and pipes everywhere.

### Stream granularity decision

Session-level events (created/updated) are the v0 unit. Richer activity — the
text tail of the last message per changed session — is a natural follow-up
("what did it just say?"), but it requires per-session body reads through
`session_message`/`part` and should be a separate `--peek` flag rather than
the default, so the default stream stays a cheap session scan. (Occ's
`activity` renders full part deltas; cotail's stream is intentionally
shallower — metadata beats, not content deltas — to stay zero-cost.)

## Rank mode — maintained stacked rank

A full-screen view refreshed on change and on the safety-net tick (ages must
not go stale while idle). Enter alternate screen buffer, hide cursor, repaint
frame on each observation.

```
SESSION RANK                              opencode-local.db · 5,254 total · watching
 1 ▸ stellar-panda   Review V2 migration invocation          /home/rektide/archive/anomalyco   5s    12 msg
 2   curious-knight  v2-migration branch relationships       /home/rektide/archive/anomalyco   9m   143 msg
 3   playful-cactus  Review V2 migration invocation          /home/rektide/archive/anomalyco   12m    7 msg
 …
31 sessions shown · 5,254 available · last change 19:02:11.284 · rank: updated · poll 1.5s
```

- Header: mode, db path, universe size, watching state.
- Rows: rank, live marker (a session updated within ~10 s glows/bolds), slug,
  title, directory, age since `time_updated`, recent message count.
- Footer: shown/available counts, last-change time, rank key, poll cadence.
- The universe is **always computed in full**; the viewport shows top-N.
  `--limit 0` shows all that fit; rows beyond the terminal height are simply
  not drawn (no scrolling in v0 — see Open Questions).
- Redraw **on change** (debounced ~25 ms) and **every safety-net tick** (so
  ages and the live marker refresh even when nothing changed).

## Ranking keys, ties, and stability

The rank is a **total order**: every key is `(keyExpr DESC, id ASC)`. `id`
breaks all ties deterministically, so identical keys never swap row positions
between polls — verified necessary: the live DB has 59 sessions sharing a
single `time_updated`. An unstable rank would make idle frames flicker rows
that had not moved.

```sql
-- membership is always: time_archived IS NULL AND (scope clauses)
-- key 1: recency (default) — matches history's ordering, least surprising
ORDER BY s.time_updated DESC, s.id

-- key 2: live-first then recency — pushes active sessions above idle history
ORDER BY (s.time_updated >= :liveWindow) DESC, s.time_updated DESC, s.id

-- key 3: activity velocity — messages in a window (v1+v2, summed like history)
ORDER BY (recent_expr) DESC, s.time_updated DESC, s.id
-- recent_expr = (SELECT count(*) FROM session_message sm
--                 WHERE sm.session_id=s.id AND sm.time_created >= :win)
--               + (SELECT count(*) FROM message m
--                 WHERE m.session_id=s.id AND m.time_created >= :win)

-- key 4: burn — token/cost velocity over a window (v2-only columns)
-- = current cumulative tokens_input/output/cost MINUS the previous frame's
--   snapshot of the same session, per elapsed second. The engine already
--   keeps prior session state for update detection, so this is a free delta.
```

Decisions and options:

| key | cost | default? | notes |
|---|---|---|---|
| `updated` | one tiny scan | **yes** | history parity; the "least surprising" initial rank |
| `live` | one tiny scan | no | the "what is happening right now" view; one boolean expression |
| `activity` | per-session index range-scans | no | meaningful when many sessions are idle but several are churning |
| `burn` | v2-only, needs prior state | no | attractive dashboard candy; schema-gated |

The **live marker** is orthogonal to the rank key: whatever the key, a session
updated within the last ~10 s is visually flagged. This separates **what is
newest** (the ordering) from **what is active right now** (the annotation) —
the two intuitions users conflate in "what's happening".

Schema drift guard: `cost`/`tokens_*`/`time_archived`/`version` are v2-era
columns; a v1-era DB lacks them. Watch feature-detects columns
(`PRAGMA table_info(session)`, as `existingTables` already does for tables,
`src/opencode/db.ts:31`) and degrades: no `time_archived` → membership is
everything; no `cost`/`tokens_*` → `burn` key rejected with a clear error.

## Bounded vs all

- **Membership** ("everything available") is all non-archived sessions, minus
  explicit `--since` / `--directory` scopes. The universe size is always
  reported in the footer so "bounded" is visible.
- **Viewport** is `--limit` (default: terminal rows minus header/footer).
  `--limit 0` = all. Bounding never changes membership or rank — it only
  truncates the drawn frame. A session that ranks 200th is in the universe,
  just not drawn; the footer's "5,254 available" makes that explicit.

## TTY / non-TTY behavior

| | stream | rank |
|---|---|---|
| **TTY** | flowing lines; colors on | alt-screen maintained frame; colors, live markers |
| **piped** | plain lines (no color, no truncation) | `top -b`-style repeated frames at poll cadence; `--oneshot` for exactly one |
| **`--json`** | one JSONL object per `ChangeEvent` | one JSONL `frame` object per refresh |

The pipe/color split reuses the existing `format.ts` trick — `const isTTY =
process.stdout.isTTY` (`src/format.ts:1-9`) — promoted to a module-wide
decision (color palette, frame mode, truncation width) made once at startup.

**Non-TTY rank parity with `top -b`:** repeated frames separated by a blank
line are a well-understood convention (batch mode), give `--oneshot` for
automation, and `--json` for machines. Rationale for not defaulting non-TTY
rank to a single snapshot: rank is a *maintained* product; a one-shot snapshot
is exactly what `--oneshot` (or `history`) is for. Non-TTY default = repeated
frames keeps the mode's contract ("maintained") intact everywhere.

## Redraw mechanics and signals

Rank redraw strategy, v0 = **full-frame reprint**:

- enter: `\x1b[?1049h` (alt buffer) `\x1b[?25l` (hide cursor) `\x1b[2J\x1b[H`
- per frame: `\x1b[H` + rows + `\x1b[J` (clear-to-end erases leftovers from a
  shorter previous frame)
- exit: `\x1b[?25h` (show cursor) `\x1b[?1049l` (leave alt buffer), then a
  trailing newline so the shell prompt lands on a fresh line.

Full reprint is correct and simple; at a 1.5 s cadence over ≤ ~40 rows it is
the right first cut. A **diff renderer** (only rewrite rows whose text changed,
clear-to-end after the last changed row) is a later optimization — the frame
model must be *pure* (list of rows) so diffing is a `string` comparison per
row, not a re-layout. Line truncation uses `process.stdout.columns`; on resize
the width is re-read and the next frame re-lays-out.

Signals:

- `SIGINT` / `SIGTERM` → run the exit sequence (restore cursor, leave alt
  buffer), then `process.exit(0)` (interactive watch) / `130` (SIGINT
  convention — decision under Open Questions). The exit path is a single
  `restore()` function called from the signal handlers, an `error` handler,
  and normal completion, so every exit restores the terminal.
- `SIGWINCH` / `process.stdout.on("resize")` → schedule the next frame with
  the new width/height. (Node exposes `rows`/`columns`/`resize` on the TTY
  WriteStream; no manual termios needed for sizing.)
- **`EPIPE`** → exit 0 quietly. `cotail watch --mode stream | head` must die
  cleanly when `head` closes the pipe (occ sets `SIGPIPE → SIG_DFL`;
  in Node the equivalent is an `'error'` handler on `process.stdout` that
  exits on `code === "EPIPE"`). Without this, a stream user hitting `q` in a
  pager leaves a zombie watch.
- Stream mode additionally tolerates downstream closed stderr for logging.

## JSON / automation

Stream (`--json`) — one object per `ChangeEvent`, stable hand-built shape:

```json
{"db":"/home/rektide/.local/share/opencode/opencode-local.db",
 "at":"2026-08-11T19:02:11.284Z",
 "kind":"session",
 "firstSeen":true,
 "session":{"id":"ses_…","slug":"stellar-panda","title":"Review V2 migration invocation",
            "directory":"/home/rektide/archive/anomalyco",
            "version":"0.0.0--202607210045",
            "timeCreated":"…","timeUpdated":"…"}}
```

Rank (`--json`) — one object per refresh:

```json
{"kind":"frame","at":"…","db":"…","mode":"rank","rank":"updated",
 "total":5254,"shown":31,
 "rows":[{"rank":1,"id":"ses_…","slug":"stellar-panda","title":"…","directory":"…",
          "ageMs":5100,"live":true,"recent":12}, …]}
```

Contracts:

- Every line is complete and parseable; no partial frames, ever.
- Timestamps ISO-8601 in JSON, epoch-ms in the human `tsv`-style stream line.
- `--json` implies "no ANSI, no cursor movement, no alt screen" regardless of
  TTY — the machine contract overrides the display contract (occ's
  `Palette::new(!no_color && !json)` precedent).
- Automation recipes: `cotail watch --mode rank --oneshot --json` for a cron
  snapshot; `cotail watch --mode stream --json | jq -r 'select(.firstSeen) |
  .session.title'` for a notification filter; `cotail watch --mode stream
  --since 24h --backfill 50` for a session-activity digest.

## Testability

The loop/render split is the test seam. The project currently has **no test
runner** (`"test": "echo \"Error: no test specified\""`); this wave introduces
one. Options: `node:test` (built-in, zero-dep, matches the project's "no npm
deps" identity) vs `vitest` (AGENTS.md's default preference). Recommendation:
`node:test` — the README's entire selling point is zero-dependency Node 22+
(`node:sqlite`), and the watch engine's needs (async ticks, injected fakes)
are covered. Flagged under Open Questions because AGENTS.md explicitly
prefers vitest.

Test layers:

1. **Fixtures.** `makeFixtureDb(rows)` builds an opencode-shaped in-memory DB
   (`new DatabaseSync(":memory:")` with `session`, `session_message`, `message`
   tables), both v1-only and v2-only shapes, plus the live-DB pathologies:
   duplicate `time_updated` ties, null `title`, archived rows, an empty `event`
   table.
2. **Engine** (`watch/engine.ts`). Inject `now()`, `wake` as a pushable
   `EventEmitter` or manual `tick()`, and poll with `pollIntervalMs: 0`
   disabled. Assert: create-vs-update on first/second sighting; overlap
   dedupe does not double-emit equal-timestamp rows; cursor advances only
   after equal-cursor drain; a new session with a backdated timestamp is
   caught on a later tick; removal detection.
3. **Rank** (`watch/rank.ts`, pure). Feed session lists; assert total order
   with ties broken by id, that `live` pushes the hot window to the top, that
   `activity` counts match hand-computed numbers, that `burn` is rejected on a
   schema without `tokens_*`.
4. **Render** (`watch/frame.ts`, pure). Golden-string tests for frame and
   stream lines at fixed widths: truncation with `…`, footer counts, blank
   separation between non-TTY rank frames, the backfill marker.
5. **Terminal.** Only the *escape sequences* are asserted (enter/exit restore
   pairs, hide/show cursor) as a string contract against a mocked
   `write()`. No pseudo-TTY is needed in v0.

## Decisions (recommended) and open questions

Decisions this lead commits to:

1. **One command, two modes**: `cotail watch --mode stream|rank`, defaulting
   to `rank` on TTY and `stream` piped; explicit `--mode` overrides.
2. **One observation loop, two renderers**; the loop is session-sweep-based
   (cursor over `time_updated` + overlap + `(id, ts)` dedupe), gated by
   `PRAGMA data_version`, woken by `fs.watch` + safety-net poll. The `event`
   journal is *not* a base dependency (it is empty on the live DB).
3. **Default rank key `updated`**, tie-broken by `id`, with `live`/
   `activity`/`burn` as opt-in keys and the live *marker* orthogonal to the
   key. Total order, always.
4. **Rank v0 = full-frame reprint** in the alternate screen buffer, redrawn
   on change and on the poll tick; diff rendering deferred.
5. **Non-TTY rank = `top -b` repeated frames**; `--oneshot` for a single
   frame; `--json` overrides all display behavior.
6. **Stream stays metadata-only** (session created/updated); content-peek is a
   future `--peek`.
7. **Signal contract**: `SIGINT`/`SIGTERM` → `restore()` → exit; `resize` →
   re-render; `EPIPE` → exit 0.

Open questions:

1. **Explicit mode vs auto-default.** `history` set the precedent "bare
   command → explicit subcommand required". Does `watch`'s TTY-sensing default
   violate that spirit, or is it the right ergonomic exception? If explicit:
   `cotail watch stream|rank` positional, defaulting to none → help.
2. **`--rank` value vocabulary.** `updated`/`live`/`activity`/`burn` are
   proposed. Should `activity`'s window and `live`'s window be `--window <dur>`
   tunable, or fixed (10 s / 15 min)? Fixed for v0, tunable later — confirm.
3. **`SIGINT` exit code.** 0 (watch is "done") or 130 (convention)? The exit
   must not print a stack or partial frame either way.
4. **Test runner.** `node:test` (zero-dep, on-brand) vs `vitest` (AGENTS.md
   preference). This wave decides it for the whole project, not just watch.
5. **Scroll / history in rank.** A session below the fold is invisible in v0.
   `]`/`[` page navigation (om precedent) or a scroll offset `--offset <n>`?
   Recommend deferring; the footer's "5,254 available" keeps the boundedness
   honest.
6. **Multi-DB.** `occ activity --all-dbs` merges every `opencode*.db`. v0
   watches the single discovered DB; if it goes quiet mid-watch (channel
   switch), should watch re-discover? Recommend: detect and note in the
   footer, never silently switch.
7. **`--peek` depth.** When it lands: last message only, or last N with tool
   summaries? Scope it before building the body-read path.

## Implementation sequence

1. **Fixtures + characterization.** `node:test` setup, `makeFixtureDb`, tests
   for the tie/overlap/archived pathologies against the current
   `countActiveSessions` SQL to lock in baseline semantics.
2. **Engine.** `src/watch/engine.ts` with injected clock/wake/poll; cursor +
   dedupe + create/update + removal. All engine tests green before any
   terminal code.
3. **Rank pure core.** `src/watch/rank.ts` (total-order sorters) +
   `src/watch/frame.ts` (pure render). Golden-string tests.
4. **Stream command wiring.** `src/commands/watch.ts` for `--mode stream`:
   args (reuse `parseSince`/`parseDirectoryArg`), engine → line renderer,
   `--json` event shape, backfill, EPIPE handling.
5. **Rank command wiring.** TTY detection, alt-screen enter/exit, full-frame
   redraw, resize, signals, non-TTY repeated frames, `--oneshot`, frame JSON.
6. **Schema-drift gates.** `PRAGMA table_info(session)` feature detection;
   `burn`/`time_archived`/`version` degrade paths.
7. **CLI help + README.** Command table entry, both modes, automation
   recipes; note the mode default rule.
8. **Polish (later):** diff renderer, `--peek`, scroll, `--all-dbs`.

## Reference

- [`src/commands/history.ts`](/src/commands/history.ts) — existing batch
  renderer to imitate in style; its table/JSONL/TSV split informs the
  `--json`/human split here.
- [`src/opencode/session.ts`](/src/opencode/session.ts) — the sweep SQL this
  loop generalizes; `message` + `session_message` summing reused for the
  `activity` key.
- [`src/opencode/db.ts`](/src/opencode/db.ts) — `discoverDb`, `openReadOnly`,
  and the `existingTables` pattern to extend to columns.
- [`src/args.ts`](/src/args.ts) — `parseSince`/`parseDirectoryArg` reused
  verbatim for `--since`/`--directory`.
- [`/home/rektide/src/opencode-session-fab/README.md`](file:///home/rektide/src/opencode-session-fab/README.md) —
  the correctness and wake-mechanics source of truth (debounce, data_version
  gate, overlap window, `first_seen`).
- [`/home/rektide/src/opencode-session-fab/crates/occ/src/main.rs`](file:///home/rektide/src/opencode-session-fab/crates/occ/src/main.rs) —
  `activity`/`sessions` command shapes; `Since::{Now,Rowid,Beginning}`.
- [`/home/rektide/src/opencode-multiview/README.md`](file:///home/rektide/src/opencode-multiview/README.md) —
  the rollup/rank intent (`-n`, `-c`, `-1`, `-r`), unimplemented — the shape
  to beat.
- [`/home/rektide/archive/doc/opencode/history.md`](file:///home/rektide/archive/doc/opencode/history.md) —
  schema and the §5 warning that data_version change-watching is exactly what
  a live mode needs.
- [`.design/v2.md`](/.design/v2.md) — `session_message` indexes/columns and why
  summing `message` + `session_message` never double-counts.
- [Node: `node:sqlite`](https://nodejs.org/api/sqlite.html),
  [`fs.watch`](https://nodejs.org/api/fs.html#fswatchfilename-options-listener),
  [`process.stdout`](https://nodejs.org/api/process.html#processstdout),
  [`tty`](https://nodejs.org/api/tty.html) — the zero-dep primitives the
  engine and terminal layer build on.
- [SQLite `PRAGMA data_version`](https://www.sqlite.org/pragma.html#pragma_data_version) —
  the change gate; changes iff another connection committed.
