---
type: Design
title: "cotails history — recent-session viewer"
description: "Design for a `cotails history` subcommand that lists sessions active within a cutoff period, with directory, title, and recent/total message counts, in table/JSON/TSV output."
resource: /home/rektide/src/opencoattails/.design/history-viewer/design.md
tags: [cotails, cli, history, opencode]
status: decided
generated: { by: human:rektide + agent:opencode, at: 2026-07-30T00:00:00Z }
sources:
  - id: opencode-history
    resource: file:///home/rektide/archive/doc/opencode-history.md
    title: "Searching opencode session history with SQLite (schema + tested SQL)"
  - id: cotails-v2-design
    resource: file:///home/rektide/src/opencoattails/.design/v2.md
    title: "opencode v2: impact on cotails (session_message, event-sourced model)"
---

# `cotails history` — recent-session viewer

## Goal

A subcommand that answers **"what was I working on recently, and where?"** — list
every session active within a cutoff period (default 24h), showing at minimum the
**directory**, ideally the **title**, and usefully the **message count in the
period** vs **in total**. Must support JSON and column-separated output for
scripting.

This complements the existing search command: `search` finds sessions *by
content*; `history` finds sessions *by recency*. Unlike search, history does not
scan message bodies, so it needs **no FTS index** and runs in milliseconds
against the live DB regardless of database size.

## Command surface

### Subcommand dispatch (prerequisite)

`opencotails.ts` is currently a single flat command: `parseArgs` treats every
invocation as a content search. We move to an **explicit-subcommand** CLI (the
project is <1.0, so this breaking change is fine, and it matches the README's
planned `index` / `search` / `status` surface):

```
cotails                        # print help / list subcommands
cotails history [flags]        # new — this design
cotails search <pattern> ...   # the current search behaviour, now explicit
```

Dispatch rule in `main()`: `argv[0]` selects the subcommand (`history` / `search`);
bare `cotails` or an unknown subcommand prints usage and exits non-zero. The
existing search logic moves under `search` unchanged. **This is a breaking
change** (`cotails foo` must now be `cotails search foo`) — call it out in the
commit and README.

**Structural recommendation (light):** extract the shared helpers that both
commands need into small modules rather than duplicating them:

- `src/db.ts` — `discoverDb()`, `detectMode()`, read-only open.
- `src/commands/search.ts` — current logic.
- `src/commands/history.ts` — new.
- `src/cli.ts` — dispatcher + per-command arg parsers.

Keep the no-build, run-the-`.ts`-directly model (`node opencotails.ts`); no
effect.ts / bundler引入 in this step (that's the separate phase-2 plan).

### Command name

`history` — matches the user's "history viewer" framing. Alternatives considered:

| name | pro | con |
|---|---|---|
| **`history`** (recommended) | matches user's mental model | slightly generic |
| `recent` | describes the default cutoff behaviour | less evocative as a noun |
| `sessions` / `ls` / `list` | conventional | doesn't imply time-bounded |

Decision point — see Open Questions.

## Flags

```
cotails history [--since <dur>] [--limit <n>]
                [--directory <path>] [--json | --tsv] [--db <path>]
```

| flag | default | meaning |
|---|---|---|
| `--since <dur>` | `24h` | cutoff: sessions with `time_updated >= now - dur`. Accepts `Nh`, `Nd`, `Nm`, or an epoch-ms / ISO-8601 absolute time. |
| `--limit <n>` | `0` (unlimited) | cap number of results. |
| `--directory <path>` | none | scope to sessions under a directory (substring match). |
| `--json` | off | emit JSONL (one object per line). |
| `--tsv` | off | emit tab-separated rows with a header line. |
| `--db <path>` | auto-discover | shared with search; honours `$OPENCODE_DB`. |

`--since` is the heart of the command. Examples: `--since 24h`, `--since 7d`,
`--since 30m`, `--since 2026-07-29`.

**Format selection:** boolean flags mirroring search's existing `--json`, per
decision. Default (neither flag) = human `table`. If both `--json` and `--tsv`
are passed, `--json` wins. (A future unified `--format` flag can subsume both
across commands — deferred.)

## Data model & query

### What "active within the cutoff" means

Primary filter: **`session.time_updated >= cutoff`**. `time_updated` is bumped on
message activity, so it is a faithful "this session did something recently"
signal. There is no standalone index on `session.time_updated`, but the `session`
table is small (3,196 rows on the reference DB) so a full scan is trivial
(sub-ms). This returns **101 sessions** for a 24h window on the live DB.

> Alternative considered: "`≥1 message created in the window`" via an `EXISTS`
> on the message table. Marginally more precise but costlier and rarely
> different from the `time_updated` signal. `time_updated` recommended.

### What a "message" is

One **`message`** row (v1) or **`session_message`** row (v2) = one turn
(user/assistant/etc). This is the intuitive unit the user asked for. Parts are a
finer sub-unit (text/reasoning/tool fragments) and are **not** counted here — a
"parts in period" metric is available separately if ever wanted.

### v1/v2 handling — sum both, no detection needed

Per `.design/v2.md`, a given session's content lives in **either** `message`
(v1-native) **or** `session_message` (v2-native), **never both** — the v2
projector only writes legacy `message`/`part` rows for v1 events, and v2-native
sessions leave them empty. Therefore the total/recent counts can **sum both
tables safely with no double-counting**, and we need no mode detection for
history:

```sql
SELECT
  s.id,
  s.title,
  s.directory,
  s.slug,
  s.time_created,
  s.time_updated,
  ( (SELECT count(*) FROM message m
       WHERE m.session_id = s.id)
  + (SELECT count(*) FROM session_message sm
       WHERE sm.session_id = s.id) )                                   AS messages_total,
  ( (SELECT count(*) FROM message m
       WHERE m.session_id = s.id AND m.time_created >= :cutoff)
  + (SELECT count(*) FROM session_message sm
       WHERE sm.session_id = s.id AND sm.time_created >= :cutoff) )    AS messages_recent
FROM session s
WHERE s.time_updated >= :cutoff
  AND (:dir IS NULL OR instr(s.directory, :dir) > 0)
ORDER BY s.time_updated DESC
LIMIT :limit;
```

- `:cutoff` is bound once (epoch-ms) and used for both the session filter and the
  message counts, so "messages in period" and "sessions active in period" share
  one definition of "the period".
- Both count subqueries hit existing indexes: `message_session_time_created_id_idx
  (session_id, time_created, id)` and the v2 compound `(session_id, time_created,
  id)`. Each is an index range scan — cheap even at 100+ sessions.
- `:limit` binds to a very large number when `--limit` is 0 (unlimited).
- This is a **read-only** connection, short-lived, opened and closed per the
  existing WAL discipline.

Verified against the live DB: returns sensible rows (e.g. the session
"History viewer subcommand design" → 6 recent / 6 total; a long-running session
→ 75 recent / 143 total).

## Output

### Fields

| field | source | notes |
|---|---|---|
| `id` | `session.id` | truncated in table view (`ses_049b7839ef`), full in json/tsv |
| `title` | `session.title` | truncated in table view |
| `directory` | `session.directory` | **required** — the navigational anchor |
| `messages_recent` | derived | in the cutoff window |
| `messages_total` | derived | all-time |
| `time_updated` | `session.time_updated` | sort key; human in table, ISO-8601 in json, epoch-ms in tsv |
| `time_created` | `session.time_created` | included for context (json/tsv; optional in table) |
| `slug` | `session.slug` | json/tsv only |

### `table` (default, human)

Aligned columns, ANSI colour when TTY, truncation with `…`. Most-recent-first.

```
ID             TITLE                          DIRECTORY                            RECENT  TOTAL  UPDATED
ses_049b7839ef History viewer subcommand de…  /home/rektide/src/opencoattails          6      6  2026-07-30 14:27
ses_0722be107f Vuio symlink directory displa… /home/rektide/archive/vuiodev/vuio      75    143  2026-07-30 14:26
ses_04fe2494af opencode activity timer plugi… /home/rektide/src/openlastcode         115    287  2026-07-30 14:24
…
101 sessions active in the last 24h
```

### `json` (JSONL — one object per line, matches existing search `--json`)

```json
{"id":"ses_049b7839effeWEP11T6eeaLy7v","title":"History viewer subcommand design","directory":"/home/rektide/src/opencoattails","messages_recent":6,"messages_total":6,"time_created":"2026-07-30T14:27:11Z","time_updated":"2026-07-30T14:27:45Z","slug":"history-viewer-subcommand-design"}
```

### `tsv` (tab-separated, header row — pipe-friendly)

```
id	title	directory	messages_recent	messages_total	time_updated
ses_049b7839effeWEP11T6eeaLy7v	History viewer subcommand design	/home/rektide/src/opencoattails	6	6	1785469665082
```

## Out of scope (future)

- **Message-body preview / snippets** — that's `search`'s job; history stays
  metadata-only and fast.
- **`--follow` / live watch** — out of scope here. A snapshot watcher can use
  the history projection without full CDC; exact activity needs a journal or
  durable-log source. See the later
  [`watch` research](/.design/watch/README.md).
- **Session detail / transcript dump** — separate planned command (see
  `.design/v2.md` "session-dump ticket").
- **FTS index dependency** — explicitly none; history reads the live DB directly.
- **Aggregates** ("messages across all sessions in window") — easy later if
  wanted.

## Decisions (resolved)

1. **Command name:** `history`.
2. **Bare `cotails`:** explicit subcommand required. `cotails` alone → help;
   existing search becomes `cotails search` (breaking change, project is <1.0).
3. **Format flag:** boolean `--json` / `--tsv` mirroring search's `--json`
   (default = human `table`; `--json` wins if both given).
4. **JSON shape:** JSONL (one object per line).
5. **"Active" filter:** `session.time_updated >= cutoff` (fast, faithful).
6. **Scope:** ship `--directory`, `--limit`, and the three output modes together.

## Reference

- [`/archive/doc/opencode-history.md`](file:///home/rektide/archive/doc/opencode-history.md) — canonical schema + tested SQL for `session` / `message` / `part` / `event`.
- [`.design/v2.md`](file:///home/rektide/src/opencoattails/.design/v2.md) — why v2 content lives in `session_message` and why summing both tables is safe.
- [`opencotails.ts`](file:///home/rektide/src/opencoattails/opencotails.ts) — current single-command implementation to split into subcommands.
