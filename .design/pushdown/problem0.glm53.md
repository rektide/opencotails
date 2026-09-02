---
type: ProblemReport
title: cotail is unusable against the live OpenCode database
description: Silent exit 1 on every command, caused by one unknown message variant; and unindexed content search over a 20 GB database that pushes us back to hand-written full-scan SQL.
resource: /.design/pushdown/problem0.glm53.md
tags: [cotail, opencoattails, validation, forward-compat, error-reporting, performance, fts]
status: stable
generated: { by: agent:opencode-main, at: 2026-08-29T00:00:00Z }
verified: { by: model:zai/glm-5.3-max, at: 2026-09-02T00:00:00Z }
stale_after: 2026-10-29
sources:
  - id: original-scratch-doc
    resource: /.test-agent/problem.md
    title: Promoted from scratch (2026-09-02); content otherwise unchanged
  - id: live-db
    resource: file:///home/rektide/.local/share/opencode/opencode-local.db
    title: Live OpenCode V2 database (20 GB)
  - id: opencode-schema
    resource: /packages/schema/src/session-message.ts
    title: OpenCode V2 session_message schema (defines location-switched)
  - id: validation
    resource: /packages/query-kysely/src/source/validation.ts
    title: cotail source validation (variant gate)
  - id: pushdown-brief
    resource: /.design/pushdown/draft0.gpt56.md
    title: Qualification pushdown design brief
---

> **Promotion note (2026-09-02):** moved verbatim from
> `.test-agent/problem.md`. This is the founding problem statement of the
> pushdown wave — uncited by any `.design/` document until now. Status
> raised to `stable`: the correctness half (silent exit on unknown variant)
> is resolved by trusted profiles and `location-switched` support; the
> performance half is substantially improved and partially still open — see
> [live-reprobe0](/.design/pushdown/live-reprobe0.glm53.md) for the
> content-search OOM that remains.

# cotail is unusable against the live OpenCode database

## Situation

On 2026-08-29 I tried to answer a simple question with cotail: *which sessions,
in which directories, discussed "acp" in the last month?* (`cotail search acp
--since 30d`). Every cotail command exits `1` with **no output at all**. The
fallback was hand-written SQL against the live 20 GB database, and even a
single `LIKE '%acp%'` pass over `part.data` could not finish inside a 120 s
timeout. The tool whose entire purpose is to be "grep for opencode session
history" currently cannot run, so we are authoring the slow full-table scans
ourselves — which is exactly what is bogging the system down.

Two independent problems, one aggravator:

1. **Correctness**: cotail refuses to start against the live database.
2. **Visibility**: when it refuses, it prints nothing and exits 1.
3. **Performance** (the aggravator): even unbricked, content search is an
   unindexed query-time scan, and its absence is what drives us to raw SQL.

## Live database facts

Measured 2026-08-29 against `~/.local/share/opencode/opencode-local.db`
(WAL mode, shared with the running opencode server):

| Fact | Value |
|---|---|
| File size | 20 GB (+ 11 MB WAL) |
| Sessions (`session_v2`) | 6,939 |
| Message rows (`session_message`) | 342,850 |
| Part rows (`part`) | 1,209,100 |
| Legacy `message` rows (post-migration leftovers) | 286,927 |
| Migration marker | `migration.v1-v2` phase `completed` (legacy gate passes) |

`session_message` type distribution:

| type | rows |
|---|---|
| assistant | 308,006 |
| user | 31,224 |
| synthetic | 2,886 |
| compaction | 412 |
| system | 293 |
| model-switched | 138 |
| agent-switched | 7 |
| **location-switched** | **3** |

Those **3 rows** are what kills the CLI.

## Failure 1 — forward-compatibility brick on unknown message variants

Source validation runs `select distinct type from session_message` and
hard-fails the whole source if any type is outside
`CURRENT_MESSAGE_VARIANTS`
([capabilities.ts:16](/packages/query-kysely/src/source/capabilities.ts),
gate at
[validation.ts:359-365](/packages/query-kysely/src/source/validation.ts)):

```ts
const unknownTypes = observedTypes.filter((type) => !CURRENT_MESSAGE_VARIANTS.has(type as MessageVariant)).sort();
if (unknownTypes.length > 0) {
  return yield* Effect.fail(new IncompleteContentModelError({ variants: unknownTypes }));
}
```

`location-switched` is a legitimate current OpenCode V2 variant — it is
defined in opencode's own
[`packages/schema/src/session-message.ts`](/packages/schema/src/session-message.ts)
and written by `core/src/session/message-updater.ts` whenever a session's
Location changes. cotail's variant list predates it.

The design intent (README: *"validates … known Message variants before
exposing a query source"*) was a guardrail against decoding surprises. But
OpenCode ships new `session_message` variants routinely, so **any** opencode
update can silently brick cotail for every user. Three rows out of 342,850 —
rows cotail would otherwise never need to interpret — currently block all
three commands.

What we need:

- Unknown `session_message` types must **degrade, not brick**: report them as
  an unindexed/unsupported variant (excluded from document projections and
  counts, surfaced as a warning or capability), and keep querying everything
  else.
- Strict mode can stay available behind a flag for deliberate audits.
- A regression habit: before cutting a cotail release, diff the variant list
  against a current opencode `packages/schema/src/session-message.ts`.

## Failure 2 — silent exit 1: errors with empty messages are swallowed

The command entrypoints catch and print only `(e as Error).message`
([history.ts:155-163](/src/commands/history.ts),
[search.ts:229-244](/src/commands/search.ts)):

```ts
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
```

`IncompleteContentModelError` is an Effect `TaggedError` carrying
`{ variants: ["location-switched"] }` and **no message string** — so the
catch prints an empty line and exits. Every failure of this class looks like
a hang-or-crash with zero diagnostics.

Repro (kept at [cotail-repro.ts](cotail-repro.ts) in this directory):

```
$ cd ~/src/cotail && node .test-agent/cotail-repro.ts
name: IncompleteContentModelError
message: ""
keys: [ '_tag', 'variants' ]
full: { "_tag": "IncompleteContentModelError", "variants": ["location-switched"] }
```

What we need:

- A single error renderer at the CLI boundary that prints `_tag` plus the
  structured payload (and a human sentence per known
  `SourceValidationError`), so *no* failure is ever silent.
- Exit codes that distinguish usage (2) from source/validation (1) failures
  already exist partially; keep them, but never with empty output.
- The globally installed shim (`~/.local/share/pnpm`, installed 2026-08-08)
  has the same behavior — after fixing, decide whether to re-link from the
  checkout or version-bump and reinstall.

## Failure 3 — unindexed content search over a 20 GB database

Even with the variant gate fixed, today's search path cannot serve "find acp
in the last 30 days" acceptably:

- Documents are materialized **at query time** via `json_extract(data,
  '$.text')` over `part.data` / `session_message.data`
  ([world.ts:44](/packages/query-kysely/src/relations/world.ts)).
- Term matching is `instr(lower(text), lower(value))` for literals, and a
  **JS `regexp()` custom function** invoked per candidate row for regex
  ([match.ts:29-44](/packages/query-kysely/src/direct/match.ts), registered
  at [node-sqlite.ts:83](/packages/query-kysely/src/runtime/node-sqlite.ts)).
- The README states this plainly: *"There is no index or build step"*.

At 1.2 M parts / 20 GB that is a full scan with per-row JSON parsing (and
per-row JS calls for regex) on every search, executed read-only against the
database the live opencode server is writing. This is why our fallback hand
queries timed out, and why "we are bogging down the system with our own
queries."

The in-flight pushdown design work
([.design/pushdown/](/.design/pushdown), drafts 0-1) addresses query
*shape* — qualification, ordering, windows, aggregation — and is valuable,
but it optimizes scans; it does not remove them, and none of it is testable
against the live db while Failure 1 stands.

What we need:

- A **sidecar index** owned by cotail (its own SQLite file, keyed to the
  source database identity — see the existing durable-source-identity work
  in `cotail-bookmarks-source-catalog`), never writing to opencode's db.
  FTS5 with the trigram tokenizer covers substring and case-insensitive
  word matching, and can back regex pre-filtering.
- Incremental maintenance: an `cotail index` command advancing a checkpoint
  (rowid / `time_created` watermark) over new `part`/`session_message`
  rows; automatic catch-up on first search; `--reindex` for schema changes.
- Search then becomes: FTS candidate rows → join back to sessions with the
  existing qualification/pushdown machinery for `--since`/`--directory` and
  windows.
- Budget guardrails while unindexed paths remain: cap scanned rows / time
  and say so, rather than appearing to hang (relates to open
  `cotail-query-access-policy`).

## Stopgap: a safe ad-hoc recipe until the tool works

Until cotail runs, use time-bounded two-phase queries instead of whole-table
`LIKE` scans: resolve candidate `session_id`s first via an *indexed* range on
`session_message.time_created` (or `session_v2.time_updated`), then scan only
those sessions' parts with `json_extract`, ideally with
`PRAGMA cache_size` bounded and `--readonly`. Keep these in `.test-agent/`
only — the moment `cotail search` works again, delete them. (The motivating
query — "acp" sessions/directories from the last month — is still unanswered
and should be the first thing run against the fixed tool.)

## Proposed work items

Ordered; beads candidates in cotail's tracker (25 open issues exist today,
none cover these):

1. `cotail-error-rendering` — never-silent CLI errors (tag + payload + hint
   per `SourceValidationError`). Small, unblocks all diagnosis.
2. `cotail-compat-unknown-variant` — degrade on unknown `session_message`
   variants instead of failing the source; strictness behind a flag; add the
   opencode-schema diff habit. Small; unblocks all three commands today.
3. `cotail-search-index` — sidecar FTS5/trigram index, `cotail index`
   command, checkpointed catch-up, search rewrite onto it. Larger; removes
   the full scans that push us to raw SQL.
4. `cotail-adhoc-stopgap` — document (and then delete) the bounded ad-hoc
   recipe above.

## Cross-references

- [.design/pushdown/](/.design/pushdown) — qualification pushdown drafts;
  performance redesign in flight, currently untestable on the live db.
- [.design/query/](/.design/query), [.design/query2/](/.design/query2) — the
  relational query world and scoped execution the operations run in.
- [.design/session-report/](/.design/session-report) — canonical Session
  observation work that search/history both build on.
- `cotail-bookmarks-source-catalog` (beads) — durable OpenCode source
  identities; the natural keying for a sidecar index file.
- `cotail-query-access-policy` (beads) — query budget policy; where scan
  caps belong.
- [README.md](/README.md) — current contract: read-only connections,
  validation-before-source, "no index or build step" (this report disputes
  the last point at current db scale).
- [cotail-repro.ts](cotail-repro.ts) — minimal repro of Failures 1 and 2.
