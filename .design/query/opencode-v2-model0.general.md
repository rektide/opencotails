---
type: Research
title: OpenCode V2 model and cotail query integration
description: Source-backed reference on OpenCode V2 terminology, persistence, Effect architecture, integration seams, result grains, V1 removal, and the Kysely boundary.
resource: /query/opencode-v2-model0.general.md
tags: [cotail, opencode, v2, query, effect, kysely, sqlite, integration]
status: draft
generated: { by: model:openai/gpt-5.6-sol, at: 2026-08-15T00:00:00Z }
stale_after: 2026-10-15
sources:
  - id: opencode-v2-source
    resource: https://github.com/anomalyco/opencode/tree/f7545bfab4679747738aac5293faabfe13c3c26c
    title: OpenCode V2 source at the investigated revision
    last_modified: 2026-08-13
  - id: cotail-current-query
    resource: /query/design1.md
    title: Current cotail query design and implementation state
  - id: cotail-kysely-selection
    resource: /.test-agent/query-kysely-selection/README.md
    title: Executable Kysely selection investigation
  - id: cotail-storage-authority
    resource: /query/authority0.md
    title: Mixed V1 and V2 storage authority
---

# OpenCode V2 Model And Cotail Query Integration

## Executive Summary

OpenCode V2 supplies a strong **source model**, but not the complete query/result
model cotail needs. Its public packages define branded Session, Message, Event,
Location, Project, Shell, Snapshot, Tool, and fork-boundary schemas. Its server
offers paginated session and per-session message reads. It does not offer
cross-session content queries, multiple content hits per session, per-session
top-N, grouped lineage hits, aggregate rows, evidence products, or stable
addresses for every nested content item. Cotail should reuse stable OpenCode IDs
and vocabulary where they exist, while retaining its own identity/reference
core, witness/evidence semantics, result grains, capability model, and
operation-specific products.

V2 persistence is SQLite through Drizzle plus an Effect SQL integration. The
authoritative projected read models are `session_v2` and `session_message`;
`session_message.seq` is unique within a session and is the canonical message
order. Assistant text, reasoning, and tools are nested in a JSON `content[]`
array. The durable `event` log is not a dependable external history relation:
event sequence watermarks always advance, but event payload persistence is an
optional server setting and defaults off. Cotail therefore needs a logical V2
schema over projected rows, not an event-sourcing dependency.

OpenCode does not use Kysely. Kysely can coexist without changing OpenCode:
cotail's standalone reader can keep a separate read-only connection and expose
a narrowed logical schema. Embedding Kysely against OpenCode's live connection
is harder because OpenCode's Effect SQL layer serializes access and coordinates
transactions; an unrelated Kysely adapter over the same native handle would
bypass that discipline. An embedded implementation should either use a separate
read connection, execute Kysely-compiled reads through an approved Effect SQL
adapter, or remain outside the process. This is an integration constraint, not
a reason to migrate OpenCode away from Drizzle.

OpenCode V2 is genuinely Effect-based, not merely Effect-flavored. It uses
Effect 4 beta Services, Layers, Scopes, Streams, Schema errors, tracing spans,
managed runtimes, and a typed global/location layer graph. It still has Promise
and mutable imperative islands around third-party APIs and synchronous SQLite.
Cotail can sensibly adopt Effect for service boundaries, lifecycle, errors,
capabilities, tracing, and composition while leaving relational selection,
joins, windows, projection, grouping, and aggregates to Kysely.

The strongest near-term integration path is a **reusable cotail library with
Effect Services/Layers and a V2-only Kysely read store, composed by the existing
standalone CLI**. The same service contracts can later be hosted in OpenCode as
an internal package plus CLI command or server endpoint. The current plugin API
is not a query extension seam: plugins cannot register OpenCode CLI commands,
and their Session domain omits session listing and message reads.

Dropping V1 should mean: require `session_v2` and `session_message`; read only
those relations; hard-error on V1-only databases; and, when preserved legacy
tables contain rows, require OpenCode's completed V1-to-V2 migration marker
before reading. Completed mixed physical databases remain normal deployment
reality, but cotail no longer performs mixed ownership, V1 fallback, or residue
reconciliation. This removes one layout adapter, union roots, owner guards,
conditional count branches, collision checks, and most authority fixtures while
remaining safe against reading a migration in progress.

## Source Map

All OpenCode links below are pinned to commit
[`f7545bfab4679747738aac5293faabfe13c3c26c`](https://github.com/anomalyco/opencode/commit/f7545bfab4679747738aac5293faabfe13c3c26c).
The checkout was `/home/rektide/a/a/opencode`; line ranges were verified against
that revision.

| Subject | Canonical source | Why it matters |
|---|---|---|
| V2 package rule | [`AGENTS.md` lines 1-5](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/AGENTS.md#L1-L5) | Declares `packages/opencode` V1-only and names the V2 package set. |
| Public Session schema | [`packages/schema/src/session.ts` lines 16-55](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session.ts#L16-L55) | Stable ID, lineage, project, model, usage, location, time, and revert shape. |
| Public Message schema | [`packages/schema/src/session-message.ts` lines 20-253](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session-message.ts#L20-L253) | Message variants and nested assistant content/tool states. |
| Public Event schema | [`packages/schema/src/event.ts` lines 9-71](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/event.ts#L9-L71) | Event IDs, aggregate sequence, version, and payload envelope. |
| Session event vocabulary | [`packages/schema/src/session-event.ts` lines 264-330](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session-event.ts#L264-L330), [`332-592`](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session-event.ts#L332-L592) | Shell, step, text, reasoning, tool, compaction, and revert facts. |
| Projected SQLite schema | [`packages/core/src/session/sql.ts` lines 21-117](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/sql.ts#L21-L117) | Physical session, message, pending columns and indexes. |
| Durable event tables | [`packages/core/src/event/sql.ts` lines 4-25](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/event/sql.ts#L4-L25) | Event sequence and optionally persisted event rows. |
| Session queries | [`packages/core/src/session.ts` lines 464-542](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session.ts#L464-L542) | Actual filters, keyset order, message order, and public core operations. |
| Projection behavior | [`packages/core/src/session/projector.ts` lines 96-208](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/projector.ts#L96-L208), [`332-347`](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/projector.ts#L332-L347), [`590-625`](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/projector.ts#L590-L625) | Fork copies, message `seq`, and committed revert deletion. |
| Active context | [`packages/core/src/session/history.ts` lines 15-89](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/history.ts#L15-L89) | Compaction-aware runner history, distinct from complete transcript. |
| Database layer | [`packages/core/src/database/database.ts` lines 11-55](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/database/database.ts#L11-L55) | Effect/Drizzle database service, PRAGMAs, migrations, and path configuration. |
| Event persistence switch | [`packages/core/src/bus.ts` lines 157-181](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/bus.ts#L157-L181), [`304-354`](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/bus.ts#L304-L354) | `persist` defaults false; projections and watermarks survive without event rows. |
| V1 migration | [`packages/core/src/database/v1-migration.ts` lines 512-617](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/database/v1-migration.ts#L512-L617) | Per-session replacement and current completion state. |
| Effect graph | [`packages/util/src/effect/layer-node.ts` lines 18-114](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/util/src/effect/layer-node.ts#L18-L114), [`250-282`](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/util/src/effect/layer-node.ts#L250-L282) | Typed dependency nodes, replacement, cycle checking, and Layer compilation. |
| Server composition | [`packages/server/src/routes.ts` lines 48-156](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/server/src/routes.ts#L48-L156) | Global service graph, replacements, HTTP handlers, and migration layer. |
| Public HTTP query surface | [`packages/protocol/src/groups/session.ts` lines 45-148](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/protocol/src/groups/session.ts#L45-L148), [`packages/protocol/src/groups/message.ts` lines 7-45](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/protocol/src/groups/message.ts#L7-L45) | Session and per-session message pagination limits. |
| Plugin surface | [`packages/plugin/src/effect/plugin.ts` lines 18-43](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/plugin/src/effect/plugin.ts#L18-L43), [`effect/session.ts` lines 9-44](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/plugin/src/effect/session.ts#L9-L44) | Plugin domains, hooks, and the deliberately limited Session API. |
| Embedded SDK | [`packages/sdk-next/src/opencode.ts` lines 8-48](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/sdk-next/src/opencode.ts#L8-L48) | Managed embedded server/client and SDK plugin registration. |
| Current cotail V1 boundary | [`capabilities.ts` lines 23-82](/packages/opencode-live-store/src/schema/capabilities.ts#L23-L82), [`session-root.ts` lines 10-20](/packages/opencode-live-store/src/query/session-root.ts#L10-L20) | Exact current mixed-layout detection and canonical union. |
| Current cotail content layouts | [`layout/v1.ts` lines 4-23](/packages/opencode-live-store/src/layout/v1.ts#L4-L23), [`layout/v2.ts` lines 4-38](/packages/opencode-live-store/src/layout/v2.ts#L4-L38) | V1 part rows versus V2 message/content extraction. |

## 1. Domain Terminology And Object Model

### Session, project, workspace, and location

`Session.Info` is the stable public source shape. A Session has a branded `id`,
optional continuation `parentID`, optional explicit `fork`, `projectID`, optional
agent/model, accumulated cost/tokens, timestamps, title, `Location.Ref`, optional
subpath, and optional staged revert. It does **not** expose every physical
`session_v2` column: slug, version, share URL, metadata, summary columns,
compaction/suspension timestamps, and raw permissions remain internal projected
fields ([public schema](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session.ts#L27-L49),
[physical table](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/sql.ts#L21-L71)).

A `Location.Ref` is `{ directory, workspaceID? }`; a `Project` is a repository-
like identity with a canonical root and known directories; a `Workspace` is a
provider-backed execution placement, not a synonym for project or cwd
([Location](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/location.ts#L8-L22),
[Project](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/project.ts#L12-L58),
[Workspace table](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/workspace/sql.ts#L5-L11)).
Cotail should not collapse these three axes into `directory`.

### Parent, child, subtask, continuation, and fork

V2 has two lineage edges:

- `parentID` means continuation-style ancestry.
- `fork.sessionID` plus a `before|through` message boundary means an explicit
  copied-history fork ([fork schema](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session-fork.ts#L6-L16)).

Fork projection sets `parent_id = null`, stores `fork_session_id` and boundary,
copies qualifying messages with new message IDs but preserved `seq`, and reserves
the inherited sequence watermark
([projector](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/projector.ts#L96-L208)).
Therefore `parentID` alone cannot find all children. A logical lineage relation
needs an edge kind and `COALESCE(fork_session_id, parent_id)` only as a traversal
convenience, not as semantic erasure.

“Subtask” is V1 residue, not a V2 domain object. V2 tools can create or continue
Sessions, but the V1 migration deliberately omits V1 subtask marker pairs
([migration design lines 101-108](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/docs/design/v1-v2-database-migration.md#L101-L108)).
Cotail should use `child session`, `continuation`, and `fork`, not preserve
`subtask` as a universal relation.

### Message, content, prompt, response, reasoning, tool, and shell

`SessionMessage.Info` is a tagged union of control and transcript records:
agent/model switches, user, synthetic, system, skill, shell, assistant, and
compaction. A user message embeds prompt text and attachments. An assistant
message is one logical model step with a `content[]` array of text, reasoning,
and tool items, plus model, usage, finish/error/retry, snapshots, and timestamps
([message schema](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session-message.ts#L55-L206)).

OpenCode does not persist a general `Part` entity in V2. “Part” survives as a
useful UI/content word, but V2 identity is uneven:

- message: branded `msg_*` ID;
- assistant text/reasoning item: array position, no item ID;
- assistant tool item: unbranded `id` plus array position;
- tool execution context: branded `Tool.CallID`, message ID, and session ID;
- shell message: message ID plus branded `shellID`;
- tool result content: nested content array, again without universal IDs.

“Prompt” is input material, not the persisted row grain. “Response” is not a
separate durable entity; assistant messages and step events represent model
output. One V2 “step” is one logical LLM call and maps to an assistant message
([step events](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session-event.ts#L287-L330)).

### Snapshots, revisions, compaction, revert, status, and events

Snapshots are content-addressed filesystem tree IDs managed by a Location-scoped
service, not transcript revisions
([Snapshot service](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/snapshot.ts#L39-L66)).
OpenCode has no public generic “revision” object. Relevant revision-like axes are
message `seq`, aggregate event `seq`, snapshot IDs, staged revert boundaries,
and compaction epochs. They are not interchangeable.

Compaction writes a message record containing summary/recent text. The runner's
active context starts at the latest completed compaction, but a transcript query
can still read all projected messages
([history](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/history.ts#L15-L72)).
A committed revert deletes projected messages at and after a boundary, so those
rows are no longer queryable from the canonical projection
([projector](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/projector.ts#L590-L625)).

Status (`idle|retry|busy`) is ephemeral
([status schema](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/session-status-event.ts#L9-L41)).
Durable event payloads have IDs and aggregate sequences, but payload retention is
optional. Cotail must label event/history products by capability and must not
promise historical events merely because `event_sequence` exists.

### Existing locator/reference concepts

OpenCode's public `Reference` is a named local-directory or Git source used for
reference material. It is not a locator to a Session, Message, content item, or
event ([schema](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/src/reference.ts#L11-L40)).
Prompt file sources contain URIs, but those identify attachments, not transcript
positions. Fork and revert boundaries contain message IDs, but are specialized
domain values.

**Assessment:** reuse OpenCode branded IDs and fork-boundary vocabulary. Do not
reuse `Reference` as cotail's generic pointer. Cotail still needs a small
identity/address core that can represent at least Session, Message, nested
content position, tool call, shell execution, event sequence, and a cotail-owned
bookmark/reference ID.

## 2. Persistence And Query Model

### Stack and physical rows

OpenCode uses Drizzle ORM `1.0.0-rc.2`, Effect `4.0.0-beta.101`, and SQLite
([root catalog](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/package.json#L39-L74)).
Its custom Effect/Drizzle package sits over Effect SQL and either `bun:sqlite` or
`node:sqlite`. The database service applies WAL, `synchronous=NORMAL`, busy
timeout, cache size, foreign keys, and migrations before exposing the Drizzle
client ([database service](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/database/database.ts#L25-L48)).

The primary projected relations for cotail are:

- `session_v2`: one current row per Session;
- `session_message`: one current projected message per row, JSON payload in
  `data`, ordered by `(session_id, seq)`;
- `session_pending`: admitted but not yet visible work;
- `project`, `project_directory`, and `workspace`;
- `event_sequence`: aggregate watermark/owner;
- `event`: optional durable payload history.

Drizzle row types are physical implementation types. Public schema types decode
and reshape them; for example `fromRow()` constructs `Session.Info` and omits
internal columns
([row decoder](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/info.ts#L14-L59)).
Cotail should similarly distinguish physical rows, logical query rows, and result
products.

### Ordering, pagination, and indexes

Session listing orders by `(time_updated, id)` and uses a keyset anchor containing
both values. Messages order by `seq`; cursor lookup first resolves a message ID
to its sequence. Direction reversal is handled before/after the query
([Session implementation](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session.ts#L464-L537)).

Relevant indexes are:

- `session_v2` project, workspace, parent, and partial suspended indexes;
- unique `(session_id, seq)` for messages;
- `(session_id, type, seq)` for typed message scans;
- `(session_id, time_created, id)` and global message creation time.

There is no index on `session_v2.time_updated`, fork parent, title, directory, or
JSON content in the investigated schema
([table indexes](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/session/sql.ts#L63-L91)).
Cotail's metadata sorting and content regex scans may therefore sort/scan even
when expressed cleanly in Kysely. Kysely improves construction, not plans.

### Projection and history behavior

The event Bus commits projectors, optional local commit hooks, the sequence
watermark, and optionally the raw event in one immediate transaction
([Bus commit](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/bus.ts#L235-L358)).
`session_v2` and `session_message` are therefore current materialized projections.
They are canonical reads even when `event` is empty. Updates to an existing
message preserve its original row `seq`; appends use the durable event sequence,
so gaps are expected.

Forks copy projected rows and assign new message IDs. Reverts delete projected
rows. Compaction does not delete complete transcript rows, but changes the
runner-context selection. These facts prevent treating `message.id`, `seq`, and
event history as one universal revision coordinate.

### Kysely coexistence

No Kysely import or dependency exists in current OpenCode V2. Coexistence is
practical in a standalone cotail process because the database is SQLite/WAL and
cotail already has a select-only `node:sqlite` adapter
([live-store open](/packages/opencode-live-store/src/index.ts#L19-L73)).
No OpenCode migration is required.

Embedding has three constraints:

1. OpenCode's native connection and Effect SQL client are Scope-owned and guarded
   by a semaphore ([Node adapter lines 40-140](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/database/sqlite.node.ts#L40-L140)).
2. A Kysely adapter over that native handle would bypass the Effect SQL semaphore,
   transaction context, spans, and failure model.
3. A second read connection is simple for a file database but not equivalent for
   `:memory:` embedded SDK databases.

A future in-process adapter must make one of those tradeoffs explicit. This
research does not recommend replacing OpenCode's Drizzle stack.

## 3. Effect Architecture

### Genuine architecture

Effect is the V2 program architecture across core, protocol, server, CLI, client,
AI, and plugin packages. Representative patterns include:

- `Context.Service` interfaces plus `Layer.effect` implementations, as in
  `Session`, `SessionStore`, `Snapshot`, and `Plugin`;
- a typed `LayerNode` dependency graph with global and Location scopes, static
  dependency checks, replacements, cycle detection, and memoized compilation;
- Scope-owned resources and fibers, explicit finalizers, `ManagedRuntime` for
  embedded OpenCode, and scoped plugin registrations;
- `Stream` for model output, event subscriptions, durable logs, and SSE;
- Effect `Schema` for public values, branded IDs, codecs, tagged unions, and
  `TaggedErrorClass` failures;
- `Effect.fn("Name")` and spans for tracing/observability;
- generated Effect and Promise clients over the same protocol schemas.

The CLI itself is an Effect composition root using Effect's unstable CLI,
Node services, observability, and scoped runtime
([CLI root](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/cli/src/index.ts#L57-L88)).
The server compiles an application graph and injects selected services into HTTP
request scope. This is substantially more than incidental imports.

### Mixed and imperative areas

The architecture is not “pure Effect.” SQLite calls are synchronous inside
Effect wrappers. Third-party MCP/provider APIs require `Promise` bridges.
Services often hold mutable Maps/Sets behind Effect synchronization. The plugin
package deliberately offers parallel Promise and Effect APIs. Some private
helpers remain plain async functions.

This is a useful precedent for cotail: use Effect where dependency, lifecycle,
error, concurrency, scope, stream, and instrumentation semantics matter. Do not
wrap pure Kysely expression construction or ordinary row mapping in Effect solely
for stylistic uniformity.

### Cotail extension seams

A reusable cotail library can expose Effect services for:

- store opening/closing and read transaction scope;
- source-schema/version capability validation;
- operation execution and typed failures;
- optional index freshness/capability;
- tracing and metrics;
- result streaming where a complete array is unnecessary.

The standalone CLI can provide file-backed V2 store, configuration, and renderer
Layers. An OpenCode-hosted composition can provide an implementation backed by
OpenCode's Database service or by a read connection. The operation contracts and
result products can remain the same while the Layer differs.

OpenCode's `makeGlobalNode` and `makeLocationNode` are internal utilities, not
necessary cotail public API. If cotail enters the OpenCode monorepo, its query
service is naturally global/database-scoped; filesystem enrichment can be a
separate Location-scoped service.

## 4. Integration And Extension Seams

### Package boundaries

`@opencode-ai/schema` and `@opencode-ai/protocol` are public packages. Core,
server, and `sdk-next` are private workspace packages even though core has broad
source exports
([schema package](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/schema/package.json#L7-L28),
[core package](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/package.json#L4-L25)).
Stable external code should import public Schema/client surfaces, not
`@opencode-ai/core/session/sql`.

The CLI command tree and dynamic handler map are static source structures
([command spec](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/cli/src/commands/commands.ts#L29-L68),
[handler map](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/cli/src/index.ts#L16-L55)).
Plugins transform slash-command catalog entries; they do not register process
CLI subcommands.

### Integration Option Matrix

| Option | Feasibility now | Coupling | Query/cardinality fit | Main constraint | Assessment |
|---|---|---:|---:|---|---|
| External cotail CLI reads DB | High | Physical schema | High | Must detect schema/migration and accept synchronous local reads | Best current delivery path. |
| Reusable cotail package linked into OpenCode | High inside monorepo; medium external | Internal Database/Layer graph | High | Kysely connection/transaction coordination | Best eventual code-sharing path. |
| OpenCode package plus CLI command | High with upstream source changes | CLI and internal package APIs | High | Command registry is static; not a plugin | Good host after library stabilizes. |
| OpenCode Effect plugin | Low for query | Public plugin/client APIs | Low | Session plugin domain lacks list/messages; no DB or CLI registration | Reject as primary query integration. |
| New server endpoint | High with upstream source changes | Protocol/server/client generation | High | Public API design, auth, pagination, server load | Good remote/multi-client product, heavier than needed now. |
| Extend public SDK/client only | Low without endpoint | Public HTTP schema | Low-medium | Existing APIs require N+1 message reads and client-side scans | Suitable consumer, not query engine. |
| Extend private `sdk-next` host | Medium-high | Private embedded server/core | High | In-memory DB and Kysely adapter issue | Useful upstream incubation seam. |

The strongest path is **standalone reusable cotail library first, with an Effect
service boundary and V2 Kysely store; upstream internal package/CLI or endpoint
later**. It preserves CLI utility now and does not force either project to adopt
the other's persistence library.

## 5. Result Grains And Cardinality

### Why Session alone is insufficient

OpenCode's current APIs are rooted in one page of Sessions or one Session's page
of Messages. That is suitable for UI navigation. Cotail needs query operations
whose natural rows differ. Forcing all products into `Session.Info` plus optional
fields would recreate the over-broad `Composite` concern: fields would have
different cardinalities, identities, costs, and freshness.

An identity/reference core can be shared, but operation-specific result products
should preserve grain and evidence semantics.

### Concrete grains

| Grain | Stable identity/order available | Cardinality and product notes |
|---|---|---|
| Session | `Session.ID`; order usually `(time_updated,id)` | One row per Session. Public `Session.Info` is reusable; query summary may add physical-only fields deliberately. |
| Message | `(sessionID,messageID)`; `seq` order | Many per Session. Message ID is globally primary-keyed physically, but include Session ownership in references. |
| Content item | `(sessionID,messageID,contentIndex)`; message `seq`, then array index | Many per assistant Message; user/shell can use synthetic index `0`. Text/reasoning have no upstream item ID. |
| Tool call | `(sessionID,messageID,toolCallID)` plus content index | Tool `id` is meaningful but unbranded in assistant content/events. Return state and evidence separately. |
| Shell execution | `(sessionID,messageID,shellID)`; message `seq` | A shell is both a Session Message and a separate ephemeral/retained process object. Historical projected message is the reliable query source. |
| Grouped Session | root Session identity plus ordered child hit collection | One group can contain many Session/message/content hits. Must traverse both parent and fork edges. |
| Aggregate/history row | operation key plus group keys | Counts, min/max time, usage, event-type totals, and histograms are computed products, not entities. |
| Durable event row | `(aggregateID,eventSeq)` and event ID | Available only when event persistence capability is enabled; sequence gaps can remain. |
| Cotail bookmark/reference | cotail-owned ID plus target identity | Snapshot/provenance may survive source mutation; not equivalent to live source row. |

### Multiple results and per-Session limits

Kysely/SQL can express the required shapes without a cotail predicate AST:

```sql
WITH matching_content AS (...),
ranked AS (
  SELECT matching_content.*,
         row_number() OVER (
           PARTITION BY session_id
           ORDER BY message_seq, content_index, content_id
         ) AS hit_rank
  FROM matching_content
  WHERE <caller selection>
)
SELECT * FROM ranked
WHERE hit_rank <= :per_session_limit
ORDER BY session_updated DESC, session_id, hit_rank;
```

This yields multiple message/content results per Session while applying the limit
inside each Session group. A second window can rank Sessions independently of
hits. Aggregate-only requests can `GROUP BY session_id`; nested grouped products
can be assembled in TypeScript after a flat ordered query, avoiding dependence
on SQLite JSON aggregation as a public result contract.

Correlated scalar subqueries are useful for one earliest witness or one count.
They become awkward for multiple hits and repeat predicates. Window functions
are the more general per-group limit mechanism. The investigated Node SQLite was
3.53.3 and Bun SQLite was 3.53.0; both executed window functions. Neither accepted
the `LATERAL` keyword. Cotail should not design around PostgreSQL-style lateral
joins. SQLite supports correlated subqueries, but a derived table in `FROM` is
not a drop-in `LATERAL` replacement.

### Universal union versus operation products

A universal discriminated union is useful only at a renderer/serialization edge
that intentionally accepts heterogeneous rows. It should not be the internal
query result model. A better research direction is:

- shared target identity/reference values;
- shared provenance and source-capability metadata;
- separate Session, Message, ContentHit, ToolHit, ShellHit, GroupedSession,
  AggregateRow, EventRow, and Bookmark result products;
- operation-owned ordering, cursor, evidence, and grouping metadata.

This retains lateral composability without pretending that a count and a snippet
are optional properties of the same entity.

## 6. Dropping V1

### V1-Removal Simplification Ledger

| Current cotail area | V2-only change | What disappears |
|---|---|---|
| `LayoutCapabilities` | Require current `session_v2` + `session_message`; retain only feature capabilities | `v1`, owner-union `mixed`, complete V1 table/column validation, V1/V2 ID collision checks ([current code](/packages/opencode-live-store/src/schema/capabilities.ts#L3-L81)). |
| Physical schema types | Keep V2 tables and any queried project/event tables | `session`, `message`, `part` Kysely interfaces and DB members ([tables](/packages/opencode-live-store/src/schema/tables.ts#L18-L48)). |
| Canonical Session CTE | Select `session_v2` directly or alias it as logical `session` | `UNION ALL`, V2-owner anti-join, branch-conditioned query typing ([root](/packages/opencode-live-store/src/query/session-root.ts#L10-L20)). |
| Content normalization | Keep V2 user and assistant-array branches | Entire `layout/v1.ts`, `excludeV2Owners`, and V1 role/part JSON semantics. |
| History counts | Count `session_message` | V1 count subqueries and owner-conditioned `CASE` ([history](/packages/opencode-live-store/src/query/history.ts#L13-L26)). |
| Search result provenance | Replace layout tag with source/grain provenance if still useful | `"v1-part"` union member and layout-based capability errors ([search domain](/packages/query-domain/src/search.ts#L43-L50)). |
| Authority tests | Keep V2 projection, migration-in-progress refusal, sequence gaps, revert, compaction, nested content | Pure-V1 behavior, V1 fallback, residue/overlap/ID-union cases, V1 tool behavior, mixed canonical-union count matrix ([authority suite](/packages/opencode-live-store/test/layout-authority.test.ts#L53-L147)). |
| Adapter fixtures | Seed V2 tables only | V1 `message`/`part` fixture builder and V1 independent-witness tests ([adapter tests](/packages/opencode-live-store/test/adapter.test.ts#L12-L34)). |
| Design vocabulary | V2 projected source | “layout precedence,” “V1 owner,” “legacy fallback,” and normalized cross-layout ordinal policy. |

The query semantics that **do not** disappear are witness identity, same-item
versus independent-item quantification, evidence ordering, result grains,
capability errors, index freshness, and operation packaging. Those were never
caused by V1.

### Migration residue and deployment reality

Dropping V1 reads does not imply legacy tables disappear. OpenCode's migration
preserves V1 rows, processes each Session transactionally, creates/owns the
`session_v2` row, replaces projected messages, and records completion only after
the loop
([migration](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/core/src/database/v1-migration.ts#L512-L617)).
The server always composes the V1 migration layer beside the API
([routes](https://github.com/anomalyco/opencode/blob/f7545bfab4679747738aac5293faabfe13c3c26c/packages/server/src/routes.ts#L133-L156)).

Therefore a normal migrated V2 database may physically contain `session`,
`message`, and `part`. “V2-only” must describe cotail's accepted authority and
read behavior, not require those tables to be absent.

The checked-in migration design's marker wording at lines 277-284 currently
differs from the implementation, which stores one JSON state at
`migration.v1-v2`. The implementation is authoritative at this revision; cotail
must test the actual marker and re-audit on upstream changes rather than freeze
the prose format.

### Recommended compatibility policy

1. Hard-error when `session_v2` or `session_message` is missing or lacks required
   V2 columns.
2. Read metadata, counts, and content only from V2 projections. Never fall back
   to V1 rows, even for a V2 owner with zero projected messages.
3. If legacy Session rows exist, require the implemented migration state to be
   completed before opening the store. Refuse absent/running/malformed state.
4. Permit preserved legacy tables after completion but ignore them completely.
5. Report the detected OpenCode schema/migration revision in diagnostics; do not
   promise arbitrary future V2 schema compatibility.

This is “migration-completed V2 owner reads with a V1-only hard error,” not a
strict “no legacy tables” policy.

## 7. Kysely Boundary

The executable selection investigation found the strongest Kysely seam to be a
store-owned seeded context plus contextual expression factories
([investigation lines 72-91](/.test-agent/query-kysely-selection/README.md#L72-L91),
[verdict lines 212-224](/.test-agent/query-kysely-selection/README.md#L212-L224)).
V2-only materially simplifies that seam: the logical `session` relation no
longer needs a mixed-layout union, while logical `content` still needs JSON
flattening.

### What Kysely already models

- typed relation/column scope and aliases;
- joins and correlated subqueries;
- `EXISTS`/`NOT EXISTS` and boolean composition;
- immutable query transforms;
- CTEs and unions;
- projection and inferred output rows;
- grouping, aggregates, scalar subqueries;
- ordering, pagination predicates, limits;
- window functions through expression/raw SQL support;
- parameter binding, compilation, execution, and dialect escape hatches.

Cotail should not recreate these as `SessionSelector`, recursive predicate nodes,
or a custom relational planner merely to avoid exposing Kysely internally.

### What cotail still owns

- semantic identity for Session/Message/content/tool/shell/event/bookmark targets;
- the distinction between filter, witness, evidence, and result;
- named witness identity and deterministic evidence choice;
- operation-specific result grains, grouping, cardinality, and cursors;
- direct-regex versus FTS semantics and backend capability;
- source authority, migration/schema validation, and index freshness;
- lifecycle, errors, tracing, cancellation, and resource scope;
- stable public products that do not expose physical columns or Kysely generics;
- bookmark/reference persistence and snapshot/live-data policy.

### Promising seam, not final API

The promising implementation seam is a store that seeds trusted logical
relations, narrows callers to those relations, accepts contextual Kysely
selection/projection construction where appropriate, then applies
operation-owned ordering, windows, limits, execution, and row packaging. Named
witness factories can build both qualification and evidence expressions without
inventing a general predicate AST.

Hard constraints are:

- V2 assistant content requires `json_each` and stable numeric array position;
- a trusted narrowing boundary is needed so physical/internal tables do not leak;
- raw `sql.ref(string)` can defeat table-scope typing;
- arbitrary caller `groupBy`, `distinct`, `orderBy`, or `limit` can change an
  operation's promised cardinality;
- SQLite has windows but no `LATERAL` keyword;
- FTS tokenizer/rank/snippet semantics remain outside Kysely's type model;
- embedding must coordinate with OpenCode's Effect SQL connection discipline.

## Candidate Vocabulary Table

This table is research input, not an accepted public naming decision.

| OpenCode term | Source meaning | Cotail relevance | Recommendation |
|---|---|---|---|
| Session | Durable aggregate plus current projected conversation/work state | Core grouping and identity axis | Reuse ID and meaning; do not force every result to Session grain. |
| Session Message | Projected tagged record ordered in a Session | Primary transcript row | Reuse `SessionMessage.ID` and variants. |
| content | Nested assistant text/reasoning/tool array item | Message-level search/evidence grain | Adapt as `content item`; add cotail locator position. |
| Part | V1 entity; informal nested-content word in V2 | Existing cotail/search vocabulary | Reject as V2 physical entity; use only generic prose if needed. |
| Project | Canonical repository-like identity and directory set | Metadata selection/grouping | Reuse `Project.ID`; do not equate with Location. |
| Workspace | Provider-backed execution placement | Capability/filter dimension | Reuse when exposed; not a project synonym. |
| Location | Directory plus optional workspace | Session placement | Reuse public `Location.Ref`. |
| parent | Continuation edge | Lineage grouping | Reuse, preserving distinction from fork. |
| fork | Copied-history branch with before/through boundary | Lineage and grouped result context | Reuse exactly. |
| child | Inverse parent/fork relation, not a stored type | Grouping/tree result | Adapt as derived edge. |
| subtask | V1 marker omitted during migration | Historical compatibility only | Reject from V2 ubiquitous language. |
| step | One logical LLM call represented by assistant message/events | Useful model-call grain | Reuse cautiously; do not call it a turn. |
| prompt | Input text/attachments admitted to a Session | Queryable user content and admission product | Reuse for input, not persisted row identity. |
| response | HTTP/model response value, not one canonical DB entity | Result/evidence ambiguity risk | Reject as transcript grain; say assistant message or operation result. |
| tool call | Nested assistant content with call ID and state | First-class query grain | Reuse and qualify by Session/Message. |
| shell | Separate process service plus projected shell message | First-class query grain | Reuse; distinguish process state from historical message. |
| reasoning | Nested assistant content text | Searchable sensitive content grain | Reuse with explicit capability/privacy policy. |
| compaction | Summary message and context-epoch boundary | History/context interpretation | Reuse; distinguish full transcript from active context. |
| revert | Staged boundary; commit deletes projected suffix | Source mutation and pointer staleness | Reuse; bookmarks may need snapshots/provenance. |
| snapshot | Content-addressed filesystem tree | Optional evidence/context | Reuse ID; not transcript revision. |
| event | Typed durable/ephemeral fact | Optional history/result grain | Reuse only behind event-persistence capability. |
| seq | Per-aggregate event/message order coordinate | Deterministic ordering/cursor | Reuse within owner scope; gaps allowed. |
| Reference | Named local/Git reference-material source | Not a Session locator | Reject for cotail pointer naming unless explicitly namespaced. |
| URI | Attachment source address | Useful only for file evidence | Reuse as attachment URI, not universal cotail address. |
| Pointer | No upstream generic equivalent | Shared cotail target identity | Retain/adapt as cotail-owned concept. |
| Bookmark | No upstream durable equivalent | Stored cotail reference + intent/snapshot | Retain as cotail-owned product. |

## Candidate Logical V2 Relation Map

**Research input only.** This maps plausible query relations; it is not an
accepted API or promise to expose every column.

| Logical relation | V2 source | Candidate fields | Stability/caveat |
|---|---|---|---|
| `session` | `session_v2` | ID, project/workspace, parent/fork, location/subpath, title, agent/model, cost/tokens, times, revert | Public `Session.Info` subset is stable; slug/version/metadata/internal times are implementation fields. |
| `lineage_edge` | `session_v2` derived | childSessionID, ancestorSessionID, kind, forkBoundary | Derived; parent and fork must remain distinct. |
| `message` | `session_message` | sessionID, messageID, type, seq, created/updated, decoded variant fields | Public message variant stable; physical `time_updated` is not in every public variant. |
| `content` | user/synthetic/system/skill/shell fields plus assistant `json_each(content)` | sessionID, messageID, messageSeq, contentIndex, kind, role, text, source payload | No universal upstream content ID; inclusion policy is cotail-owned. |
| `tool_call` | assistant content item type `tool` | target identity, name, state/status, input, output content, times, executed | Tool ID exists but is unbranded; output can have several nested content items. |
| `shell_execution` | message type `shell` | target identity, shellID, command, status, exit, output, times | Projected history is reliable; live process retention differs. |
| `compaction` | message type `compaction` | message identity, status/reason, summary/recent/error, seq/time | Completed compaction defines active-context boundary. |
| `pending_input` | `session_pending` | inputID, sessionID, type, delivery, admittedSeq, created, payload | Current unconsumed inbox only, not transcript history. |
| `project` | `project` | ID, canonical root, vcs/name/icon, times, sandboxes/commands | Public Project schema omits some physical naming differences through mapping. |
| `project_directory` | `project_directory` | projectID, directory, type/strategy, created | Physical/internal relation; useful for project resolution. |
| `workspace` | `workspace` | ID, provider, binding, created/last-used | Provider binding is internal and capability-sensitive. |
| `event_watermark` | `event_sequence` | aggregateID, seq, ownerID | Always supports current watermark, not event payload history. |
| `event_history` | `event` | eventID, aggregateID, seq, created, versioned type, data | Expose only when persistence is enabled and types decode. |
| `bookmark` | cotail store | bookmarkID, target identity, intent, captured evidence/snapshot, created | Cotail authority; may outlive or diverge from live source. |

## Effect/Kysely Responsibility Boundary

| Concern | Effect/Service responsibility | Kysely/relational responsibility | Cotail domain responsibility |
|---|---|---|---|
| Store lifecycle | acquire/release, Scope, interruption, read transaction | execute against supplied dialect | define ownership and closed-store behavior |
| Configuration | Layers/config service, source path/backend choice | none | valid combinations and defaults |
| Schema capability | typed failure and startup validation | introspection queries may be built/executed | name supported grains/features |
| Selection | execute operation service | fields, predicates, joins, exists | standard semantic helpers and authorization bounds |
| Multiple hits | cancellation/streaming | windows, ranks, per-group limit | define what “per Session” and ties mean |
| Evidence | failure/capability handling | witness query/projection/order | witness identity, provenance, eligibility, packaging |
| Aggregates | tracing and resource limits | group/aggregate/window | metric meaning and result grain |
| FTS | backend Layer/capability | MATCH/rank/snippet SQL escape hatches | tokenizer semantics, freshness, honest product |
| Results | Schema decoding/stream transport | inferred raw selected row | stable operation-specific result types |
| Errors | tagged errors and causes | driver/compiler errors | unsupported semantics versus invalid request |
| Observability | spans/log annotations/metrics | compiled query may be diagnostic data | privacy/redaction and operation names |

## Risks And Unknowns

1. OpenCode V2 is active, private in core/server, and on Effect 4 beta plus
   Drizzle RC. Physical schemas and internal service seams can change quickly.
2. Event payload persistence defaults off. Any event/history feature needs an
   explicit capability probe and a product that tolerates missing history.
3. Public `Session.Info` omits useful physical fields. Cotail must decide which
   physical fields it intentionally stabilizes rather than accidentally mirroring
   the whole table.
4. Nested text/reasoning has no upstream content ID. Array index is stable for one
   projected message value but may not survive fork-copy IDs, future projection
   rewrites, or source mutation without captured provenance.
5. OpenCode forks generate new message IDs while preserving copied sequence
   positions. Cross-fork “same content” is lineage/provenance, not identity.
6. A Kysely adapter embedded on OpenCode's native connection could violate Effect
   SQL serialization/transaction assumptions. A second connection cannot serve
   `:memory:` SDK hosts.
7. Current V2 lacks indexes for several expected cross-session filters and sorts.
   Representative `EXPLAIN QUERY PLAN` and corpus benchmarks remain required.
8. Reasoning, tool inputs/outputs, shell output, attachments, and metadata may be
   sensitive. Search/index products need redaction and inclusion policy.
9. Tool output is structured non-empty content, not one text field. The current
   cotail V2 store rejects tool search; canonical flattening remains unresolved
   ([current rejection](/packages/opencode-live-store/src/query/content.ts#L16-L19)).
10. The migration design document and implementation currently disagree on the
    exact completion-marker representation. Source-version detection must be
    tested against shipped databases.
11. OpenCode's session list search is SQL `LIKE` over title and its message API is
    per Session. Treating client-side N+1 API scans as a query backend would have
    weak performance and inconsistent snapshots.
12. Whether Kysely is part of cotail's public programmable API remains unresolved.
    Exposing it gives leverage but couples semver and allows callers to alter
    operation cardinality unless the context is constrained.

## Cross-References

- [`prompt0.gpt56sol.md` lines 40-56](/query/prompt0.gpt56sol.md#L40-L56)
  first separated session criteria, related content, evidence, and aggregates.
  This OpenCode audit confirms those are different physical and result grains.
- [`draft1.syn.md` lines 234-247](/query/draft1.syn.md#L234-L247) established
  witness/evidence/aggregate vocabulary. Its claim that every command is
  Session-rooted should now be weakened: V2 supports meaningful Message,
  content, tool, shell, event, and grouped result grains.
- [`draft-ksyley0.md` lines 497-627](/query/draft-ksyley0.md#L497-L627) records
  the earlier mixed-layout Kysely lowering. V2-only removes its V1 union and
  authority branches but not nested-content flattening or evidence semantics.
- [`draft-ksyley1.md` lines 241-275](/query/draft-ksyley1.md#L241-L275) makes
  lifecycle ownership explicit. Effect Services/Scopes are a natural stronger
  expression of that concern, consistent with OpenCode V2.
- [`authority0.md` lines 37-58](/query/authority0.md#L37-L58) remains the key
  explanation of why legacy residue cannot be unioned. Under the recommended
  policy it becomes migration-safety evidence, not an ongoing dual-layout query
  contract.
- [`query-kysely-selection/README.md` lines 143-167](/.test-agent/query-kysely-selection/README.md#L143-L167)
  proves that logical relations and named witness factories can be thin. The V2
  source audit adds the required logical grains and embedded-connection caveat.
- [`bookmarks/draft2.glm52.md` lines 64-91](/bookmarks/draft2.glm52.md#L64-L91)
  identifies Pointer as address rather than descriptor. That separation survives,
  but the pointer must now address more than an optional message/time.
- [`bookmarks/draft3.glm52.md` lines 123-196](/bookmarks/draft3.glm52.md#L123-L196)
  correctly distinguishes continuation parent from explicit fork. Current V2
  source confirms that distinction and fork boundary semantics.
- [`bookmarks/draft4.glm52.md` lines 153-181](/bookmarks/draft4.glm52.md#L153-L181)
  argues for capability detection over opaque version strings. V2-only narrows
  the capability set but does not remove schema/event/index capability checks.
- [`bookmarks/applications.glm52.md` lines 126-132](/bookmarks/applications.glm52.md#L126-L132)
  frames stored composites as producers/consumers around an address. This audit
  supports the address throughline but favors operation-specific products over
  one universal optional-slot Composite.

## Inputs For The Next Prompt

1. Treat OpenCode V2 projected storage as the only readable OpenCode layout;
   hard-error on V1-only and incomplete migration states.
2. Preserve public OpenCode branded IDs and the parent-versus-fork distinction;
   do not reuse OpenCode `Reference` as a generic locator.
3. Model Session, Message, content item, tool call, shell execution, grouped
   Session, aggregate/event, and bookmark as distinct possible result grains.
4. Decide the minimum shared target identity/reference core, including how nested
   content without an upstream ID is addressed.
5. Support multiple results per Session and explicit per-Session limits; assume
   SQLite windows and correlated subqueries, not `LATERAL` joins.
6. Keep witness identity, evidence/provenance, capability, grouping, cursor, and
   result packaging cotail-owned rather than asking Kysely to infer semantics.
7. Let Kysely own relational selection, joins, existence, projection, aggregate,
   ordering, grouping, and window construction over a narrowed logical V2 schema.
8. Use Effect Services/Layers for lifecycle, configuration, capabilities, errors,
   tracing, and composition; do not Effect-wrap pure query construction by habit.
9. Keep the standalone CLI as the first composition root and reusable library
   consumer; target an internal OpenCode package/command or endpoint later.
10. Do not select the plugin API as the primary integration seam unless OpenCode
    adds query reads and CLI/endpoint extension hooks.
11. Decide whether Kysely types are public programmable API or confined behind
    operation services before fixing a query callback shape.
12. Specify privacy and canonical text policy for reasoning, tool, shell,
    attachment, metadata, and optional event-history results.
