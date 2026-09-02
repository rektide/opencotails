---
type: Report
title: Isolated OpenCode test channel recipe
description: Live-verified procedure for running a fully isolated OpenCode instance with its own WAL database for cotail integration and concurrent-read testing, plus the channel-selection findings that motivate it.
resource: /.design/watch/test-channel0.glm53.md
tags: [cotail, testing, opencode, isolation, wal, concurrency]
status: stable
generated: { by: agent:opencode-main, at: 2026-09-01T00:00:00Z }
verified: { by: model:zai/glm-5.3-max, at: 2026-09-02T00:00:00Z }
stale_after: 2026-12-01
sources:
  - id: original-scratch-doc
    resource: /.test-agent/opencode-test-channel/README.md
    title: Promoted from scratch (2026-09-02); content otherwise unchanged
  - id: upstream
    resource: https://github.com/anomalyco/opencode/tree/e70d667a9f
    title: OpenCode source at commit e70d667a9f (cross-checked)
---

> **Promotion note (2026-09-02):** moved verbatim from
> `.test-agent/opencode-test-channel/README.md` (the 5 MB sandbox seed
> database remains in scratch; the procedure below recreates it). This is
> the standing recipe for any future integration or concurrent-WAL test —
> previously cited only by the
> [tail/watch exploration](/.design/watchman/tail-watch.gpt56s.md).

# Isolated OpenCode channel/database for Cotail integration & concurrent-WAL testing

Investigation of how to run a small, fully isolated OpenCode instance for integration
and concurrent-WAL testing of cotail, without touching the user's `local`-channel
database and without requiring a custom channel name baked into an OpenCode build.

Everything below was verified live on 2026-09-01 against the installed binary
`opencode2 v0.0.0-local-202609011923` (channel `local`), cross-checked against the
upstream source at `~/archive/anomalyco/opencode` (commit `e70d667a9f`, 2026-08-29).

**Verdict up front:** you cannot change the *channel* at runtime (it is a build-time
constant), but you don't need to. Two runtime mechanisms give complete database
isolation on the stock binary: `OPENCODE_DB` (absolute path → used verbatim) plus
XDG directory redirection (`XDG_DATA_HOME` / `XDG_STATE_HOME` / `XDG_CONFIG_HOME` /
`XDG_CACHE_HOME` / `HOME` / `TMPDIR`). The verified procedure below creates a
sandbox server on a scratch port whose WAL-mode DB cotail reads concurrently. Total
footprint ~5–10 MB (a busy run with logs/tmp peaked at 44 MB, still far below 500 MB).

---

## 1. Channel selection mechanisms (and why runtime channel switching is a non-starter)

| Mechanism | Where | Effect |
|---|---|---|
| `OPENCODE_CHANNEL` at **build time** | `packages/cli/vite.node.config.ts:270,291`; `packages/cli/script/build.ts:147`; `packages/cli/src/version.ts:2-7` | Baked into the binary via `declare const OPENCODE_CHANNEL`; defaults to `"local"` when unset at build. `OPENCODE_LOCAL = channel === "local"`. |
| `OPENCODE_TUI_CHANNEL` at **runtime** | `packages/cli/src/commands/handlers/default.ts:64` | Only changes the TUI's reported app identity (`channel:` field passed to `run()`). Does **not** affect the server, the DB filename, or service registration. |
| `--channel` flag | does not exist | Nothing in the CLI parses a channel flag. |

So: **arbitrary channel names do not work at runtime** for database/service purposes.
The channel string in the installed binary is `local`, and every channel-derived path
(`opencode-<channel>.db`, `service-<channel>.json`, default port) derives from that
baked constant.

Channel-derived names, for reference (`packages/cli/src/server-process.ts:99-103`,
`packages/cli/src/services/service-config.ts:29-44`):

- DB: `opencode.db` for channels `latest|dev|beta|next|prod` (or when
  `OPENCODE_DISABLE_CHANNEL_DB=1`), otherwise `opencode-<sanitized-channel>.db`
  → channel `local` means **`opencode-local.db`** (the user's 20 GB file — never touch).
- Service registration: `service.json` for the prod-ish channels, else
  `service-<channel>.json` → `service-local.json` in `$XDG_STATE_HOME/opencode/`.
- Default service port: `0xc0de` (49374) for prod-ish channels, `0xc0df` (49375) for
  `local`, else hash-derived (`defaultPort`).

## 2. Database path selection at runtime — the mechanisms that DO work

`packages/cli/src/server-process.ts:100` — every spawned/embedded server receives:

```ts
database: {
  path:
    process.env.OPENCODE_DB ??
    (["latest","dev","beta","next","prod"].includes(OPENCODE_CHANNEL) ||
     OPENCODE_DISABLE_CHANNEL_DB ? "opencode.db" : `opencode-${OPENCODE_CHANNEL}.db`),
}
```

and the server resolves it in `packages/core/src/database/database.ts` (`layer()`):

- `OPENCODE_DB=/abs/path/test.db` → **used verbatim** (`isAbsolute` branch).
- relative name → joined with `Global.data` = `$XDG_DATA_HOME/opencode`.
- unset → channel default name (`opencode-local.db` for this binary).

Verified the installed binary honors it at runtime: `strings` on
`/home/rektide/src/opencode-working/packages/cli/dist/cli-linux-x64/bin/opencode2`
contains `OPENCODE_DB` and `OPENCODE_DISABLE_CHANNEL_DB`.

Server-side pragmas (`packages/core/src/database/database.ts`, `databaseLayer`):
`journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`,
`cache_size = -64000`, `wal_checkpoint(PASSIVE)` at startup, `foreign_keys = ON`.

### ⚠️ The hidden hazard: background service discovery bypasses `OPENCODE_DB`

`ServerConnection.resolve` (`packages/cli/src/services/server-connection.ts`) — the
default path for `opencode` (TUI) and `opencode api` with no `--server/--standalone` —
looks up the managed service registration
`$XDG_STATE_HOME/opencode/service-local.json`. If the user's `local`-channel service is
registered and running, your test CLI **attaches to the user's running server** and
`OPENCODE_DB` is never consulted. This is why XDG isolation (below) is mandatory, not
optional: it redirects the registration lookup so no incumbent is found and a fresh
isolated server is spawned.

Escape hatches that skip service discovery entirely:
- `opencode serve` (mode `default`): no incumbent check, no registration write
  (`packages/cli/src/server-process.ts:57-64` — `serviceOptions` only in `--service` mode).
- `opencode --standalone`: spawns `opencode serve --stdio --port 0` as a child with a
  random password, per-invocation, no registration (`packages/cli/src/services/standalone.ts`).
- `opencode <cmd> --server http://127.0.0.1:PORT`: explicit attach.

### XDG / env isolation (verified)

`packages/util/src/global-roots.ts` computes all roots from env at process start:
`XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` (+ `os.tmpdir()`
for tmp). `packages/util/src/global.ts` adds `OPENCODE_CONFIG_DIR` (config override) and
`OPENCODE_TEST_HOME` (only overrides `Path.home`, **not** the roots — don't rely on it
for isolation). Locks live under `$XDG_STATE_HOME/opencode/locks` (`flock.ts:22-27`).

Verified with the installed binary:

```sh
$ opencode debug paths   # with the sandbox env below
home   …/.test-agent/opencode-test-channel/sandbox/home
data   …/.test-agent/opencode-test-channel/sandbox/data/opencode
cache  …/.test-agent/opencode-test-channel/sandbox/cache/opencode
config …/.test-agent/opencode-test-channel/sandbox/config/opencode
state  …/.test-agent/opencode-test-channel/sandbox/state/opencode
```

Post-run leak check against the real `~/.local/{share,state}/opencode` and
`~/.config/opencode`: **zero files created or modified**.

## 3. Verified setup / test / cleanup procedure

`opencode-sandbox.sh`-style recipe (this is exactly what was run):

```sh
SB=$PWD/.test-agent/opencode-test-channel/sandbox   # or anywhere under the repo
mkdir -p "$SB"/{data,state,config,cache,home,tmp,project}

# ---- env block: use for EVERY opencode invocation in the test ----
export XDG_DATA_HOME="$SB/data"  XDG_STATE_HOME="$SB/state" \
       XDG_CONFIG_HOME="$SB/config" XDG_CACHE_HOME="$SB/cache" \
       HOME="$SB/home" TMPDIR="$SB/tmp" \
       OPENCODE_CONFIG_DIR="$SB/config/opencode"
export OPENCODE_DB="$SB/data/opencode/opencode-cotailtest.db"
export OPENCODE_PASSWORD=cotail-test-pw        # read by serve (mode default) and api

opencode debug paths                           # sanity: everything under $SB

# ---- start isolated server (no --service: no registration, no incumbent) ----
nohup opencode serve --port 49777 --print-logs > "$SB/server.log" 2>&1 &
echo $! > "$SB/server.pid"
# logs: "database schema bootstrap completed" migrations=46, then
#       "server listening on http://127.0.0.1:49777"
# creates: opencode-cotailtest.db{,-wal,-shm}  (WAL mode)

# ---- credential-free write paths (no model auth needed) ----
# 1) create a session (real session_v2/project/worktree rows):
curl -s -u opencode:cotail-test-pw -X POST http://127.0.0.1:49777/api/session \
     -H 'content-type: application/json' -d '{"title":"cotail wal test"}'
# 2) synthetic inbox message (session_inbox/event_sequence rows; stays in inbox
#    until a run executes it, so it does NOT appear in cotail search):
curl -s -u opencode:cotail-test-pw -X POST \
     "http://127.0.0.1:49777/api/session/<SID>/synthetic" \
     -H 'content-type: application/json' \
     -d '{"text":"…","resume":false}'
# 3) session IMPORT = real session_message writes through the real write path
#    (POST /api/session/import, payload {info:{…}, messages:[{type:"user",…}]};
#     ids only need the ses_/msg_ prefix — SessionID is checked with isStartsWith("ses"),
#     packages/schema/src/session-id.ts:3-5). See import template in §5.

# ---- cotail against the sandbox DB ----
cd ~/src/opencoattails
pnpm exec cotail profile generate \
  --db "$OPENCODE_DB" --opencode opencode \
  --output "$SB/profile-cotailtest.json" --name cotail-test
pnpm exec cotail history --since 1h --profile "$SB/profile-cotailtest.json"
pnpm exec cotail search  "alpha beta" --profile "$SB/profile-cotailtest.json"

# ---- cleanup ----
kill "$(cat "$SB/server.pid")"     # clean shutdown checkpoints+removes -wal/-shm
rm -rf "$SB"                       # or keep data/ + profile as a seed fixture
```

Notes:
- `--port 49777` is arbitrary; plain `serve` never touches the channel default port.
  `--port 0` also works — with `--stdio` the URL is printed as JSON on stdout
  (that's how `--standalone` finds it).
- Rows written by a fresh server run: `migration`(46), `session_v2`, `project`,
  `worktree`, `kv`, `event_sequence`, plus `session_message` after imports.
- Kept in this directory after the verification run: `sandbox/data/opencode/opencode-cotailtest.db`
  (5.2 MB, checkpointed, 13 sessions) + `sandbox/profile-cotailtest.json` — a ready
  seed pair; delete freely.
- `cotail get-session` is safe under isolation: it resolves PIDs only from an explicit
  argument or `$OPENCODE_PID`, never by scanning `/proc` (`src/opencode/pid.ts:14-29`).
- `cotail discoverDb` (`src/opencode/db.ts`) honors `--db`/`OPENCODE_DB`/newest
  `~/.local/share/opencode/opencode*.db` — always pass `--profile` or `--db` in tests
  so the 20 GB `opencode-local.db` can never be picked by mtime accident.

## 4. Concurrent WAL-writer relevance to Cotail snapshot behavior

Cotail's read model (`packages/query-kysely/src/runtime/node-sqlite.ts`):

- Opens `new DatabaseSync(path, { readOnly: true, timeout: 5000 })`, then
  `PRAGMA query_only = ON` (line ~125); a `Semaphore(1)` serializes statements per source.
- `openRead` wraps reads in `BEGIN DEFERRED` … `ROLLBACK` with per-statement
  prepare/step error mapping (`busy`/`locked` → `QueryExecutionError.reason`).
- **Provenance is stamped at BEGIN time**: `readProvenance(ReadScopeID, Date.now())`
  is created immediately after `BEGIN DEFERRED` executes, before any SELECT.

Why concurrent WAL writers matter to that contract:

1. **Snapshot pin timing.** In WAL mode `BEGIN DEFERRED` does not pin a read snapshot;
   the snapshot is pinned by the *first read statement*. A writer committing between
   provenance capture and first statement makes `provenance.time` earlier than the
   observable snapshot — exactly the "one-read provenance truthful for multi-statement
   consumers" question in `design/ideas/ideas.gpt56s.md` §16 ("Standalone Execution And
   Snapshot Conformance"), which calls for "a concurrent WAL-writer proof".
2. **Reader-isolation, not locking.** WAL readers never block the writer and vice
   versa; cotail's `timeout: 5000` + server's `busy_timeout = 5000` only matter for
   checkpoint contention and any future write-path use.
3. **Checkpoint interplay.** The server checkpoints PASSIVE at startup only
   (`databaseLayer`); during the stress loop the `-wal` grew to ~5.4 MB while cotail
   read concurrently, and a clean server shutdown checkpointed and removed
   `-wal`/`-shm`. Long-lived cotail read transactions can delay checkpoint reuse —
   worth an assertion (bounded WAL) in a real test suite.

Live demonstration run (this sandbox, 2026-09-01):

- Writer: 10 sequential `POST /api/session/import` commits through the real server
  while cotail `search` ran 8 times concurrently → **all 10 writes 200**, **zero**
  `SQLITE_BUSY`/`locked` errors, 7/8 reads saw all rows and 1 early read saw fewer —
  i.e. each cotail invocation observed a stable snapshot, with reads that started
  before a commit correctly excluding it.
- Deterministic interleaving (recommended for the actual proof): use
  `acquireNodeOpenCodeSourceForTest(config, onAction)` (same file, bottom) which
  exposes hooks on `begin`/`rollback`/`prepare`/`step`/`iterator-return`/`close`;
  fire a writer commit (server import, or a synthetic `node:sqlite` writer) between
  `begin` and `prepare` and assert observed rows vs. provenance time.
- Synthetic-fixture alternative for pure unit concurrency:
  `tests/fixtures/profile/database.ts` → `indexedOpenCodeV2Fixture` builds the exact
  V2 schema (`session_v2`, `session_message`, …) in any temp DB; a plain
  `node:sqlite` writer INSERTing between cotail reads needs no server at all.

## 5. Import payload template (credential-free `session_message` writer)

```json
{
  "info": {
    "id": "ses_<anything-starting-with-ses>",
    "projectID": "<projectID from a session created in the same sandbox>",
    "cost": 0,
    "tokens": {"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},
    "time": {"created": 1788318059902, "updated": 1788318059902},
    "title": "cotail import wal writer one",
    "location": {"directory": "/abs/test/dir"}
  },
  "messages": [
    {"id": "msg_<anything>", "type": "user",
     "text": "concurrent wal writer probe alpha beta",
     "files": [], "agents": [], "skills": [],
     "time": {"created": 1788318059902}}
  ]
}
```

Shape sources: `packages/schema/src/session-transfer.ts:8-12` (`Data = {info, messages}`),
`packages/schema/src/session-message.ts:31-35` (`Base`), `:73-79` (`User`),
`packages/schema/src/session.ts:32-58` (`Session.Info`); import endpoint
`packages/protocol/src/groups/session.ts:189-205` (`POST /api/session/import`);
CLI wrapper `packages/cli/src/commands/handlers/import.ts`. GET
`/api/session/<id>/export` returns this same shape — handy for building templates.

## 6. Source references

Upstream source of record: `~/archive/anomalyco/opencode` @ `e70d667a9f` (2026-08-29);
installed binary under test: `/usr/local/bin/opencode` → `opencode2`
(`~/src/opencode-working/packages/cli/dist/cli-linux-x64/bin/opencode2`,
version `0.0.0-local-202609011923`).

- Channel build-time bake: `packages/cli/vite.node.config.ts:270,291`;
  `packages/cli/src/version.ts:1-7`; `packages/cli/script/build.ts:147`
- TUI-only runtime channel: `packages/cli/src/commands/handlers/default.ts:64`
- DB path incl. `OPENCODE_DB` + channel default name: `packages/cli/src/server-process.ts:96-104`
- DB path resolution (absolute verbatim / relative under `Global.data`): `packages/core/src/database/database.ts` (`Options`, `layer`)
- WAL/busy_timeout pragmas: `packages/core/src/database/database.ts` (`databaseLayer`)
- Service registration filename/port per channel: `packages/cli/src/services/service-config.ts:29-44`
- Service discovery default path: `packages/cli/src/services/server-connection.ts` (`resolve`)
- `serve` modes (no registration unless `--service`): `packages/cli/src/server-process.ts:54-64`; `packages/cli/src/commands/handlers/serve.ts`
- `--standalone` child spawn (`serve --stdio --port 0`): `packages/cli/src/services/standalone.ts:29-44`
- XDG roots: `packages/util/src/global-roots.ts:1-19`; `OPENCODE_CONFIG_DIR`/`OPENCODE_TEST_HOME`: `packages/util/src/global.ts`
- Flock state dir: `packages/util/src/flock.ts:22-27`
- API routes (`/api/session*`): `packages/protocol/src/groups/session.ts:131-527`
- Cotail DB discovery (env/override/mtime): `src/opencode/db.ts`
- Cotail read model (readOnly, query_only, BEGIN DEFERRED, provenance, test hooks): `packages/query-kysely/src/runtime/node-sqlite.ts`
- Cotail PID resolution (explicit-only): `src/opencode/pid.ts:14-29`
- Concurrency/provenance design context: `design/ideas/ideas.gpt56s.md` §16

*Author: subagent investigation (model: glm-5.3#max), 2026-09-01. Verified live; no
production code or user databases were modified — the user's `opencode-local.db`
(20 GB, `~/.local/share/opencode/`) was never opened by any test step.*
