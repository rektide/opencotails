---
type: ImplementationCheckpoint
title: Exact bookmark foundation — source, schema and transaction
description: Concrete store-local source catalog and Session bookmark proposal, with disposable Node/Bun and actual host-driver write evidence; awaiting parent approval.
resource: /.design/bookmarks/foundation0.gpt6a.md
tags: [bookmarks, source-identity, sqlite, transactions, checkpoint]
status: draft
generated: { by: "model:openai/gpt-6-astra#xhigh", at: 2026-09-07 }
stale_after: 2026-10-07
extensions:
  ticket: cotail-bookmarks-source-catalog
  authorization: Proposal and disposable probes only; no production bookmark implementation
sources:
  - { resource: /.design/bookmarks/audit-review0.gpt6a.md, title: Parent-reviewed guidance gate }
  - { resource: /.design/bookmarks/implementation0.gpt6a.md, title: Bounded implementation commission }
  - { resource: /src/profile/runtime.ts, title: Actual effective source selection }
  - { resource: /packages/query-kysely/src/domain/address.ts, title: Native SourceKey and Target }
  - { resource: /.test-agent/bookmark-foundation/README.md, title: Disposable write probes and reproduction }
---

# Checkpoint and proposed decision

**Approve a six-table, single-SQLite foundation and a fail-fast writer, not the
whole bookmark epic.** The [audit disposition](/.design/bookmarks/audit-review0.gpt6a.md)
released this checkpoint; no production bookmark code has been written. The
human-selected default remains owned `rektide_*` data in the **resolved actual
source DB**, with an explicit alternate bookmark DB. `rektide_cotail_*` below is
my proposed domain spelling, not a further human mandate.

The next executable slice is: **explicitly initialize/register → obtain a
registered Session Target → create → reopen → replay the request/get/resolve**.
It needs neither transcript search nor summary inference. Subsequent checkpoints
still own Message resolution, k=v metadata/indexes, and tool/RPC exposure.

## 1. Identity and selection

| Fact | Concrete rule |
|---|---|
| `SourceKey` | Reuse `{ kind: "opencode-v2", sourceID: string }`. Generate `src_${randomUUID()}` at explicit new registration; adoption explicitly supplies an existing key. No new Target algebra. |
| `storeID` | Independent `bst_${randomUUID()}` in owned metadata. A store can register many sources; a source can be explicitly adopted into several stores. |
| `bookmarkID` | `bmk_${randomUUID()}`; public lookup/receipt is qualified by `storeID`. Different requests may bookmark the same Target. |
| Effective source | Call existing `resolveRuntimeSource({ profilePath, databasePath })`. `--db` overrides `profile.source.path`; discard its profile-derived `sourceID` for durable operations. |
| Default store | Effective source path, not executable spelling, profile label, guessed channel, `OPENCODE_DB`, or TUI storage channel. Explicit bookmark DB changes storage only. |
| Catalog scope | The selected store, not an implicit XDG/global registry. Each current source binding holds a canonical DB realpath and an absolute trusted profile-file locator. |

Registration resolves the existing profile and realpaths the selected source.
Open that source through the existing read-only/query_only acquisition to check
accessibility, **without schema rediscovery**. Registration declares identity; it
does not certify that a stale trusted profile is compatible. Exact Session lookup
subsequently runs the canonical query and decoder and can report their failures.
No executable call, profile generation, validation, or refresh is implicit.

Later catalog-bound reads pass **both** the stored database path and stored
profile path into the existing selection function, then override acquisition's
`sourceID` with the registered key. Editing `profile.source.path` cannot move the
binding. Explicit operator profile maintenance can change trusted query facts,
not durable identity. Do not persist a profile/schema hash as source identity.

### Register, adopt and relocate

| Operation / encountered state | Result |
|---|---|
| Register a new unbound locator | Atomically assign a SourceKey and initial locator row. Repeating at the same realpath/profile returns the existing key, including after reopen. |
| Symlink alias of a current locator | Same realpath → same binding. Do not create another source just because spelling differs. |
| Adopt an existing SourceKey into another selected store | Explicit operator declaration plus reason; install that key and locator only in this store. No writes to the other store or source file. |
| Adopt key already current at another path, or path already bound to another key | `source-binding-conflict`; never last-write-wins or automatic replica selection. Same key/path/profile is an idempotent repeat. |
| Relocate/rebind | Operator supplies key, expected locator revision, new selection and reason. Append a new locator revision and retire the previous current row in one store transaction. A changed profile locator also requires explicit rebind. |
| New registration at a retired locator | Report the historical binding rather than resurrecting/reassigning it silently. Explicit relocation back to that locator is allowed; independent reuse/import is later management work. |
| Source missing, inaccessible, or catalog key unknown | Distinct `source-unavailable`, profile/query error, or `source-unknown`; never mint an identity during reads or bookmark creation. |

Relocation is a **declaration**, not proof that a copy was a move. The old file
need not be accessible. An encountered same key at two proposed distinct current
locators conflicts until the operator declares relocation; old locator history
survives. Do not choose a replica, compare transcript contents, or remap stored
Targets automatically.

**Detection limit:** a copied co-located catalog copies source/store IDs too.
A supplied locator override never changes the catalog's stored locator. If two
selected/explicitly compared store receipts have the same storeID at different
realpaths, report `store-copy-conflict`, not two independently writable stores.
One selected store cannot discover an unmentioned copy, a replacement at the same
path, hard-link aliases not established by realpath, or an independently registered
identity in another catalog. There is no intrinsic store-path pin or global
registry in this slice. Moving a standalone store preserves its storeID and its
stored source paths; moving a co-located source still requires source relocation.
Explicit adoption preserves source identity across stores; fresh unrelated
registration does not magically unify their keys. This preserves
[summary0's stated limits](/.design/bookmarks/summary0.gpt6a.md#minimal-source-catalog-discipline).

## 2. Owned schema v1

All table names below have prefix **`rektide_cotail_`**. Use ordinary SQLite
`STRICT` tables, `TEXT` for JSON/IDs, integer millisecond times and revisions,
explicit non-null columns except those marked nullable. No `AUTOINCREMENT`,
triggers, upstream foreign keys, project/transcript copies, or capture columns.

| Table | Fields and constraints |
|---|---|
| `bookmark_meta` | `singleton INTEGER PRIMARY KEY CHECK(singleton=1)`, `owner TEXT CHECK(owner='cotail')`, `format TEXT CHECK(format='cotail.bookmark-store')`, `version INTEGER`, `store_id TEXT UNIQUE`, `created_at INTEGER`. Exactly one row; v1 supports version `1` only. |
| `source` | `source_id TEXT PRIMARY KEY`, `kind TEXT CHECK(kind='opencode-v2')`, `created_at INTEGER`. No locator or profile-derived identity in the key. |
| `source_locator` | `source_id TEXT REFERENCES source(source_id)`, `revision INTEGER CHECK(revision>=1)`, `database_path TEXT`, `profile_path TEXT`, `active INTEGER CHECK(active IN (0,1))`, `action TEXT CHECK(action IN ('register','adopt','relocate','rebind'))`, `reason TEXT NULL`, `declared_at INTEGER`; PK `(source_id,revision)`. Adoption/relocation/rebind require a nonblank reason. |
| `bookmark` | `bookmark_id TEXT PRIMARY KEY`, `source_id TEXT REFERENCES source(source_id)`, `address_json TEXT CHECK(json_valid(address_json))`, `address_key TEXT`, `session_id TEXT`, `purpose TEXT CHECK(purpose='reference')`, `note TEXT NULL`, `created_at INTEGER`, `updated_at INTEGER`, `revision INTEGER CHECK(revision>=1)`. The v1 decoder accepts Session addresses only. |
| `bookmark_tag` | `bookmark_id TEXT REFERENCES bookmark(bookmark_id) ON DELETE CASCADE`, `tag TEXT`; PK `(bookmark_id,tag)`. Tags are a normalized set. No delete operation is exposed yet. |
| `bookmark_request` | `request_id TEXT PRIMARY KEY`, `request_json TEXT CHECK(json_valid(request_json))`, `receipt_json TEXT CHECK(json_valid(receipt_json))`. Immutable successful create-request ledger, scoped to this store. No FK/cascade to the mutable bookmark. |

Explicit indexes, also prefixed:

```sql
CREATE UNIQUE INDEX rektide_cotail_source_locator_current_source
  ON rektide_cotail_source_locator(source_id) WHERE active=1;
CREATE UNIQUE INDEX rektide_cotail_source_locator_current_path
  ON rektide_cotail_source_locator(database_path) WHERE active=1;
CREATE INDEX rektide_cotail_source_locator_path_history
  ON rektide_cotail_source_locator(database_path, declared_at DESC);
CREATE INDEX rektide_cotail_bookmark_target_created
  ON rektide_cotail_bookmark(source_id, address_key, created_at DESC, bookmark_id DESC);
```

PK indexes provide get/request replay/tag reads. The exact-target index supports
a small bounded list without a global JSON scan; additional listing/tag/project
indexes wait for actual operations. `session_id` is an exact Address projection,
not parent lineage. Future Session-scope link queries can index it explicitly.

`address_json` is the canonical native Address, not another pointer. Derive
`address_key` only from its validated coordinates: JSON encoding of
`["session", sessionID]`; next slice adds `["message", sessionID, messageID]`.
The source ID remains a separate indexed column. JSON tuple encoding avoids
delimiter collisions; JSON object member order and labels never select identity.
Use existing [`canonicalJson`](/packages/query-kysely/src/profile/canonical.ts)
on decoded JSON for stable request/address serialization. Read decoding checks
that projections match the authoritative Address. No `ReadScopeID` is persisted.

The first Bookmark wire value contains `schema: "cotail.bookmark/v1"`, store/mark
IDs, Target, purpose `reference`, note, tags, creation/update times, revision and
`kv: {}`; it has **no capture**. Reject unsupported purpose/capture/metadata input,
not silently discard it. Optional captures can later reuse the existing
[Session capture](/packages/query-kysely/src/domain/session-report-capture.ts).
The old default-report-capture proposal is not reinstated.

### Ownership, initialization and opening

1. **Never blindly use `CREATE TABLE IF NOT EXISTS`.** At explicit initialization,
   inspect only the proposed namespace and objects attached to its tables. No
   owned objects means fresh initialization; partial/foreign occupation means
   `namespace-conflict`. Another `rektide_*` owner's objects remain untouched.
2. For an existing store, decode its one metadata row and check owner/format/
   supported version against a compiled v1 schema manifest: object kinds, exact
   columns/constraints/FKs and indexes. Include SQL definitions where PRAGMAs do
   not expose constraints. Reject extra triggers/indexes on owned tables even
   when their names lack our prefix. SQLite's expected automatic PK/UNIQUE indexes
   are allowed. An owner string is a compatibility declaration, not authentication.
3. Initialize the six tables, indexes, metadata row and initial source registration
   in one `BEGIN IMMEDIATE` transaction when registration explicitly requests
   initialization. A plain `initializeStore` may use the same lower-level schema
   function without registering a source. No module needs to call its caller.
4. Ordinary **bookmark** reads validate/read an existing store under read-only/
   query_only acquisition; absent namespace is `store-not-initialized`. Existing
   search/history/session-get do not acquire this store or inspect its schema.
   No read or ordinary create call creates/migrates the schema. v1 has no upgrade
   implementation; future versions require an explicit migration operation.
5. Existing/default files open for writing using a **string SQLite URI** built
   from `pathToFileURL(realpath).href` plus `?mode=rw`, not a URL object or a
   model-supplied URI. Disposable probes proved writable existing files and
   non-creation of missing files on Node 26.6.0/Bun 1.4.1. Explicit standalone-file
   creation uses exclusive filesystem create (`wx`) before the same opener; a
   failed initialization may leave that explicitly requested empty file. No
   missing default source, fallback DB, implicit directory tree or cleanup.
6. Own connections set foreign-key enforcement and the selected busy timeout;
   do not change journal mode, checkpoint policy, OpenCode migration records,
   SQLite `user_version`/`application_id`, other owners' objects, or maintenance
   settings. Do not acquire OpenCode's Database layer: it runs upstream migrations
   and tuning pragmas. SQLite necessarily changes its internal schema cookie and
   file/WAL pages when owned objects change; “upstream unchanged” means its owned
   logical schema/rows/metadata, not byte-identical co-located files.

## 3. Small plain operation interface

Proposed names, not existing imports. Public functions return Promises of a
strict plain `{ ok: true, ... } | { ok: false, error }` union; only input/output
contracts cross the two Effect runtimes. Private query Effects stay private.

```ts
// Operator-only bootstrap: paths and initialization never come from a model.
const registration = await registerSource(
  { profilePath: fixtureProfile, databasePath: fixtureSource,
    bookmarkDatabasePath: alternateStore }, // omit alternateStore to colocate
  { schema: "cotail.source-register/v1", mode: "new", initializeStore: true },
);
if (!registration.ok) return registration;
const operator = {
  bookmarkDatabasePath: registration.store.path,
  expectedStoreID: registration.store.storeID,
};
// registration.durableSourceKey is the actual native SourceKey, not a cast
// of sessionGet's profile-derived, selection-scoped observation.
const observed = await registeredSessionGet(operator, {
  schema: "cotail.registered-session-get/v1",
  source: registration.durableSourceKey, sessionID: "ses_child",
});
if (!observed.ok) return observed;
// observed.identityStatus === "registered"; observation.target carries that key.
const saved = await bookmarkCreate(operator, {
  schema: "cotail.bookmark-create/v1", requestID: "req_example",
  target: observed.observation.target,
  purpose: "reference", note: "Checkpoint", tags: ["review"], capture: "none",
});
// saved receipt: { schema: "cotail.bookmark-create.receipt/v1", storeID,
//   requestID, bookmarkID, createdAt, revision: 1 } — stable across retries.
// bookmarkGet(operator, { schema: "cotail.bookmark-get/v1", bookmarkID })
// returns the current stored Bookmark without opening its source.
```

Registration returns operator diagnostics `store: {storeID,path}` plus
`durableSourceKey` and `locatorRevision`. Adoption changes the request to
`mode: "adopt", source: existingSourceKey, reason`; relocation is an explicit
`sourceRelocate` operation with `expectedLocatorRevision` and new operator
selection. A changed binding must not be concealed as a query option.

**How an agent will obtain durable Targets:** the operator first registers/adopts
and configures the resulting storeID/source key. At the later tool checkpoint,
expose the registered lookup with an operator-selected source (or explicit
configured source allowlist), returning `identityStatus: "registered"` and the
native Target. The agent passes that Target to exact create. Do not silently
change `cotail_session_get` v1's literal `selection-scoped` contract; add a
distinct registered operation/contract. Neither an ID's spelling nor TypeScript
branding proves registration: new create checks the selected catalog and rereads
the exact endpoint. Read permission still does not imply write permission, and
“registered” still does not prove source/server binding.

## 4. Transaction and retry semantics

For a new create, normalize/decode the bounded input, then:

1. Open the existing store read-only and check the request ledger. Identical
   normalized request returns its original receipt **before source access**;
   changed reuse yields `request-conflict`. A successful retry still works if
   the source was subsequently deleted or became unavailable.
2. Resolve the registered source and its current locator revision; call the
   real [`getSession`](/packages/query-kysely/src/operations/resolve.ts#L53) using
   that durable SourceKey. It accepts explicit children and never reads Message
   bodies. Close the source read before starting a write transaction.
3. Acquire the separate writer, `BEGIN IMMEDIATE`, and recheck the ledger first
   (another creator may have committed). Check the current source locator revision
   still matches the validated binding; otherwise `source-binding-conflict`.
   Insert bookmark, tags and immutable request/receipt together, then commit.
   All SQL between begin/commit is synchronous and bounded; no `await`, host
   Effect yield, filesystem/profile read, model call or source read in this span.
4. Any statement/commit failure rolls back; a receipt is returned only after
   commit. No nested host transaction or cross-database `ATTACH` transaction.

Ledger comparison uses versioned canonical **normalized input**, not a hash of
raw JSON or the current mutable bookmark. Preserve note bytes; omitted note is
null; tags are a deduplicated, sorted set; omitted purpose/capture normalize to
`reference`/`none`. Target coordinates and explicit descriptive differences
participate; generated IDs/times, locator paths and live reports do not.
Request IDs are store-wide, nonblank and bounded; changed operation reuse also
conflicts. Keeping the immutable receipt separate from bookmark data permits
future metadata edits without changing a create retry's result. No pruning or
delete semantics are implemented here.

Proposed wire limits: native/request IDs 1–256 UTF-8 bytes; note at most 16 KiB;
at most 64 tags of at most 128 bytes each; whole create input at most 64 KiB.
Do not trim opaque IDs. Enforce budgets at the public operation, before database
work. Registered Session reports retain the existing explicit output budget.

**Atomicity is only for owned store records.** Endpoint existence is an observed
fact before commit, even when files happen to coincide. Subsequent upstream
deletion leaves a durable dangling reference; do not prune or retarget it.
Cancellation before the transaction writes nothing; once synchronous commit has
finished, return its receipt rather than relabel success as cancelled. A caller
disconnected after commit can recover with the same request ID. This deliberately
differs from blindly copying the read operation's post-read abort check.

Stored get distinguishes `bookmark-not-found` from source resolution. Session
resolution returns `found` with fresh observation, `missing`, `source-unavailable`,
`source-unknown`, or a declared profile/query/unsupported-grain error. Without a
capture it cannot claim `current`/`changed`. Store errors distinguish missing/
not-initialized, unavailable/permission, namespace conflict, unsupported version,
corrupt record, ID mismatch, busy and locked. SQLite I/O failure must not become
“not found”; unknown defects are not swallowed as expected failures.

## 5. Demonstrated writer constraint and choice

At host jj snapshot **`d688b44adf2425becc42136b07ff445966d0370e`**,
[Bun SQL execution](file:///home/rektide/src/opencode-term-v2/packages/core/src/database/sqlite.bun.ts#L27)
calls synchronous `statement.all`; the
[host Drizzle transaction](file:///home/rektide/src/opencode-term-v2/packages/core/src/database/drizzle/effect-sqlite/session.ts#L140)
can suspend between begin and commit. The connection semaphore in
[sqlite.ts](file:///home/rektide/src/opencode-term-v2/packages/core/src/database/sqlite.ts#L62)
does not coordinate a separate Cotail connection. Real
[Bus batches](file:///home/rektide/src/opencode-term-v2/packages/core/src/bus.ts#L579)
run projectors/commit Effects inside transactions; workload contention frequency
was **not** measured by this probe.

Five disposable runs passed under [.test-agent/bookmark-foundation](/.test-agent/bookmark-foundation/README.md):

| Probe | Concrete evidence |
|---|---|
| Node 26.6.0 / SQLite 3.53.3 | Two-connection WAL commit, pinned-reader snapshot, multi-row rollback and reopen; 80 ms busy wait took **80.58 ms**, delaying a 10 ms timer to **80.66 ms**. |
| Bun 1.4.1 / SQLite 3.53.2 | Same checks through `node:sqlite`; 80 ms wait took **80.57 ms**, timer **80.62 ms**. Constructor timeout was honored on both runtimes. |
| Actual host Bun SQLite + Drizzle | A deliberately suspended host write transaction blocked owned `BEGIN IMMEDIATE`; zero timeout failed in **0.10 ms**. With 80 ms timeout, failure took **86.50 ms** and the host-release timer could not run until **86.71 ms**. Owned write then succeeded after host commit; host write succeeded after owned commit; reopen retained both. |
| Node and Bun `mode=rw` string URI | Existing fixture writable; absent file returned SQLite error 14 and was not created. This supplies a real no-create opener, not an existence-check race. |

The generic fixture checked unchanged upstream schema/Session/Message/KV rows
and preserved sentinel `user_version`/`application_id`. Host fixture writes were
intentional setup/stimulus against scratch only. It loaded the **actual host
database adapters**, not a complete plugin/server lifecycle or real workload.
No source DB, live service, plugin installation, dependency or production file
was changed. These probes test mechanisms, not an unimplemented catalog codec.

**Recommended first writer: timeout 0, one attempt, typed `store-busy`** (and
source read timeout 0 in these new registered operations). Normalize SQLite
numeric `errcode` rather than requiring Node's `code` field, which Bun omitted.
This avoids same-loop lock waiting; it does not make SQLite execution or fsync
asynchronous, guarantee wall-clock latency, or promise every overlapping write
will succeed. Keep the owned transaction short and synchronous so our connection
does not hold a write lock while waiting for host work.

Alternative for parent choice: bounded **asynchronous begin-acquisition retry**,
with zero SQLite timeout, cancellation/deadline checks and no open transaction
between attempts. It improves eventual acquisition but adds retry policy and
testing. A worker/helper adds lifecycle/transport and can still contend with the
host; neither is justified as the default response to these measurements.
**No retry/worker/helper or existing query-adapter change is authorized here.**

Receipt paths and SHA-256 (ignored scratch; this tracked summary is durable):

```text
sqlite.ts e0ab0280858f146097363ad8e8b1afdd87026212ae805d7c808b8409ae8221e6
host.ts d032fb0fcb0fb866eccda3a65ce48009856a835e2bdcc20889152dc3132ae512
open-mode.ts 5b1865ba610231dee3be89da288e77614cfe1c7b97557934b5688aea0dfa7e76
sqlite-3OA84h/report.json 07e421e374e259f0addfd3383d84924deb261358e9365aaf8b6f297fbd4a5530
sqlite-vObsdg/report.json 74ccd9f607e6d26ef99ec993b1498cc53270e0419f0ca18c12877e91b3e0b4b2
host-bjCad2/report.json 9deb40446f53005f3bb8d15bd4e4646381109a05a7b2e48b4a969cecbf883cbe
open-mode-lcoh0n/report.json 40eac890a3f539d724179a439192d947898034bf63557a2348387978057db10b
open-mode-CUZCtB/report.json 5dd9900390c5ef271297370bc0cac0e7d14623ed8be6065b046a12793b47128c
```

## 6. Module grouping and next slice

Keep this a domain-grouped module in the root package, not another backend
registry/package or extensions to read-only `LogicalQuery`:

```text
src/bookmarks/
  index.ts, contract.ts       finite plain operations and portable wire schemas
  store/schema.ts, sqlite.ts  owned manifest, explicit init, read/write lifecycle
  source/catalog.ts          registration/adoption/locator history and binding
  operations/session.ts      registered get, exact create/get/list/resolve
tests/bookmarks/              real fixture tests across that same interface
```

The source catalog uses the lower store module and existing `src/profile/`.
Session operations use catalog + store + production query operations. Store
initialization imports neither source operations nor Session operations. An
internal synchronous transaction callback lets registration compose schema
initialization and its inserts without exposing arbitrary SQL publicly. Query
package and portable contracts never import bookmark runtime. Use existing
Promise/plain-data adapter precedent; no new Effect service registry is needed.
Nested tests need explicit inclusion in the root's current top-level test command.

**After parent approval**, implement one fixture-backed vertical foundation:
schema ownership/open/init → explicit registration/adoption/relocation → registered
Session get → exact create/get/resolve and a narrowly paged exact-Target list.
The list uses `(created_at DESC, bookmark_id DESC)`, page size 1–100 and a cursor
bound to store/source/address, not general history filters. Commit coherent
implementation stages and return the executable interface for review before
metadata work. Source/catalog ticket remains in progress; store/resolve and all
later tickets stay open until their actual acceptance is met.

Fixture acceptance must cover:

1. Default/explicit profile and DB override; separate existing/new store; no
   executable/generation; symlink aliases; same profile with two DBs yields
   distinct new keys; explicit adoption retains a key; relocation conflict/history
   and reopen preserve identity. Document undetectable copy/replacement cases.
2. Missing default and explicit existing DB never created (include URI-sensitive
   filenames); reads never initialize; partial/wrong-owner/unknown-version schema,
   wrong expectedStoreID, unowned triggers on owned tables and malformed records
   fail without mutation. Permissions use a genuinely unwritable fixture context.
3. Parent/child exact Session lookup; absent Session fails before create; arbitrary
   selection-scoped SourceKeys fail catalog lookup; malformed Message JSON stays
   unread. Deliberate source-binding revision change between validation and write
   fails rather than committing under a different declaration.
4. Identical concurrent/sequential request retry has one bookmark and original
   receipt; changed normalized payload conflicts; rollback at intermediate failure
   leaves neither partial tags nor receipt. Reopen, later source deletion/loss,
   cancellation before write and lost-response retry all preserve this contract.
5. Upstream logical schema/rows, other `rektide_*` objects, migration metadata,
   `user_version`, `application_id` and journal mode remain unchanged by owned
   operations. Existing read-only/query_only tests remain unchanged and pass.
6. Bounded list uses the owned index and stable continuation; zero-timeout
   contention returns busy without partial records; successful interleaving/reopen
   on Node/Bun, including the actual host-driver fixture above.

### Preserve the k=v path, do not implement it yet

Keep [links-tools0's contract](/.design/bookmarks/links-tools0.gpt6a.md#one-small-metadata-contract):
`bookmark.target` is the source endpoint; only explicit `{kind:"target",target}`
values supply destinations. `{kind:"json",value}` is descriptive even when it
contains target-looking objects. Keys map to lists; duplicate exact target under
one key is rejected regardless of label; same destination under different keys
or bookmarks remains distinct. Empty replacement removes the key.

A later owned `bookmark_kv` relation can index destination `(source_id,
address_key,key,bookmark_id)` and Session projections, with metadata replacement
and bookmark revision in one transaction. No independent inverse bookmarks,
graph authority, upstream parentID changes, or transcript scan. Message addresses
retain their **nested Session**; exact/source-qualified indexes preserve children
and cross-source links. Backlinks are complete only for selected stores.

## Parent choices and cross-references

Please approve/steer **(a)** the six-table layout and explicit store-local identity
declarations, **(b)** the registered lookup → native Target → exact create interface,
and **(c)** fail-fast contention rather than adding acquisition retries now.
This makes durable exact Session references and replay-honest create possible;
it intentionally cannot bind a next response, infer a summary, authenticate a
server, detect every DB copy, or return global backlinks.

- [Audit review](/.design/bookmarks/audit-review0.gpt6a.md) and
  [GX dossier](/.design/bookmarks/dredge0.glm53.md) establish the released gate and
  bounded search coverage. Draft5 already existed in `5286d380` with its August
  metadata; later touches are not authorship.
- [Implementation brief](/.design/bookmarks/implementation0.gpt6a.md) defines
  the bounded slice this checkpoint concretizes, not a whole-epic authorization.
- [Callable read receipt](/.design/bookmarks/callable-read0.gpt6a.md) and
  [plugin README](/packages/opencode-plugin/README.md) supply the accepted direct
  Promise/JSON seam and selection-scoped limitation. Their completed read checks
  were not rerun here; writer exposure remains absent by default and separate
  from read RPC authorization.
- [Summary storage/source discipline](/.design/bookmarks/summary0.gpt6a.md#selectable-storage-without-widening-query-authority)
  and [draft5](/.design/bookmarks/draft5.gpt56.md#resolution-semantics) supply the
  selected-store and honest uncaptured `found` semantics retained here.
- [Query runtime index](/.design/query-runtime/README.md) distinguishes query
  instance acquisition from operation/transaction ownership; no global registry
  is a prerequisite. Existing profile runtime code, not earlier discovery sketches,
  controls ordinary `--profile`/`--db` semantics.
- [Opensesser consumer](file:///home/rektide/src/opensesser/design/bookmark-links/consumer0.gpt6a.md)
  is downstream routing work: source/server binding gates safe navigation, not
  bare storage. No UI, live calls/installation, full CLI/import/export, Beads
  resolver, all capture grains, or next-response binder is authorized by this
  checkpoint. The independent search OOM/P1 does not block metadata-only exact work.
