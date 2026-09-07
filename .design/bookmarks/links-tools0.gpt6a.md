---
type: Design
title: Bookmark key-value links and callable Cotail operations
description: Small typed bookmark metadata for exact cross-session links, plus an early read tool/RPC tracer and a separately gated exact writer.
resource: /.design/bookmarks/links-tools0.gpt6a.md
tags: [cotail, bookmarks, metadata, links, tools, rpc]
status: draft
generated: { by: "model:openai/gpt-6-astra#xhigh", at: 2026-09-07T01:39:07Z }
stale_after: 2026-10-07
sources:
  - { resource: /.design/bookmarks/summary0.gpt6a.md, title: Summary-mark proposal with parent source-receipt correction 13e2e688 }
  - { resource: /.design/bookmarks/draft5.gpt56.md, title: Target and capture foundation }
  - { resource: "file:///home/rektide/archive/doc/opencode/patches.md#session-links", title: Human cross-session link desire }
  - { resource: /packages/query-kysely/src/domain/address.ts, title: Actual canonical Target shape }
  - { resource: /packages/query-runtime/src/registry.ts, title: Implemented scoped query registry }
  - { resource: "https://opencode.ai/v2/docs/build/plugins/rpc", title: Public plugin RPC contract }
---

# Bookmark Key-Value Links And Callable Cotail Operations

## Direction And Authority

**Unaccepted design; docs/tickets only.** The human now explicitly wants
cross-session links through bookmark **k=v metadata**, browsable in Opensesser,
and Cotail available as agent-callable tools sooner. This extends
[summary0](/.design/bookmarks/summary0.gpt6a.md), not its unresolved next-response
policy. Anchors: `rekon-session-mementos-links`, `rekon-session-mementos`, and
the [session-links memento](file:///home/rektide/archive/doc/opencode/patches.md#session-links).

The current storage intent is **selected database, defaulting to Cotail-owned
`rektide_*` data in the effective selected OpenCode source/channel DB**. Update
live ticket criteria accordingly; preserve the superseded XDG-only prohibition
in history. Ordinary queries remain read-only/query_only. This does not authorize
writing upstream-owned Session, Message, KV, Event, or migration records.
Owned tables are the recommendation; exact table/schema choices remain reviewed
implementation decisions. Descriptive bookmark k=v is not upstream `kv` storage.

Parent correction `13e2e688` remains authoritative: the earlier OpenCode Git HEAD
was a separate Beads-initialization repository, not a source receipt. This pass
inspected plugin interfaces at jj working-copy snapshot
`d688b44adf2425becc42136b07ff445966d0370e`; no installed-host compatibility is claimed.

## One Small Metadata Contract

A bookmark's existing **`target` is the source endpoint**. A target-valued entry
means `bookmark.target --key--> value.target`. Do not add a second competing
`fromSessionID`, infer an endpoint from a note, or create a graph authority beside
bookmarks. Session and Message endpoints reuse
[the actual Address/Target algebra](/packages/query-kysely/src/domain/address.ts#L11):
`source: { kind: "opencode-v2", sourceID }` plus `address`, with a Message's
Session nested under `address.session`.

Proposed versioned metadata field:

```ts
type BookmarkValue =
  | { kind: "json"; value: Json }
  | { kind: "target"; target: Target; label?: string };
type BookmarkKV = Readonly<Record<string, readonly BookmarkValue[]>>;
// Bookmark wire envelope gains schema: "cotail.bookmark/v1" and kv: BookmarkKV.
```

- Keys are nonblank, case-sensitive user/application strings, not a closed
  relation taxonomy. `investigation`, `evidence`, or `related` are conventions,
  not built-in predicates, execution commands, or guaranteed parentage.
- Each key maps to a list: one value is ordinary k=v; several values express
  repeated k=v without duplicate JSON member names or silent last-write-wins.
  Empty lists normalize to absent keys. List order is presentation only.
- Under one key, duplicate target identity is rejected even with a different
  label; replace explicitly to relabel. Duplicate descriptive JSON values are
  rejected by structural JSON equality. The same target under different keys,
  and separate bookmarks with the same endpoints, are allowed distinct assertions.
- `label` is optional display text, never identity or a lookup fallback. A plain
  string such as `"ses_child"` inside `kind: "json"` is **not a link**. JSON may
  contain arbitrary descriptive objects, including target-looking objects,
  without being traversed. Only the explicit `kind: "target"` branch is indexed
  as a definitive reference. “Definitive” means exact identity, not verified
  semantic truth, existence forever, execution authority, or a content snapshot.
- `purpose: "summary"` remains explicit mark provenance. A key named `summary`,
  a target label, or a relationship to a summary does not establish summary
  purpose, successful completion, or finality. Captures remain separate/opt-in.

### Self, child, and Session-to-Message examples

Proposed wire data, not an installed API. IDs are illustrative. The bookmark
source endpoint is the coordinating Session; `self` is legal, `investigation`
points to a child, and `evidence` points into a Message in another source:

```json
{
  "schema": "cotail.bookmark/v1",
  "bookmarkID": "bmk_example",
  "target": {
    "source": { "kind": "opencode-v2", "sourceID": "source_alpha" },
    "address": { "kind": "session", "sessionID": "ses_coordinator" }
  },
  "purpose": "reference",
  "createdAt": 1788745147000,
  "note": null,
  "tags": [],
  "kv": {
    "topic": [{ "kind": "json", "value": "session navigation" }],
    "self": [{ "kind": "target", "target": {
      "source": { "kind": "opencode-v2", "sourceID": "source_alpha" },
      "address": { "kind": "session", "sessionID": "ses_coordinator" }
    }}],
    "investigation": [{ "kind": "target", "label": "child investigation", "target": {
      "source": { "kind": "opencode-v2", "sourceID": "source_alpha" },
      "address": { "kind": "session", "sessionID": "ses_child" }
    }}],
    "evidence": [{ "kind": "target", "label": "decision rationale", "target": {
      "source": { "kind": "opencode-v2", "sourceID": "source_beta" },
      "address": {
        "kind": "message",
        "session": { "kind": "session", "sessionID": "ses_implementation" },
        "messageID": "msg_decision"
      }
    }}]
  }
}
```

A Message-to-Session link simply uses that same nested Message Target as the
bookmark's main `target`; no different edge type is needed. Listing a child here
does not rewrite or prove `parentID`; explicit lookup must accept children even
when a consumer's ordinary Session list deliberately lists roots only.

## Lookup, Backlinks, And Lifecycle

Propose `metadataSet(bookmarkID, key, values)` as explicit replacement of one
key, and `links({ target, direction: "outgoing" | "incoming", key?, page })`.
Each returned assertion retains bookmark/store ID, source Target, key, destination
Target, and optional label; incoming lookup inverts navigation, not the stored
meaning. Default endpoint matching is **exact Target identity**. An optional
explicit `scope: "session"` can include nested Message endpoints belonging to
that Session and must return their actual Message Targets, not flatten them.

Store target-valued metadata in the bookmark domain, e.g. normalized
`rektide_cotail_bookmark_kv` rows with bounded indexed canonical endpoint keys.
Index the owning bookmark Target and `(destination_source_id, destination_key,
key, bookmark_id)` for backlinks; add source/Session projections for the explicit
Session scope. Canonical endpoint encoding comes from the decoded Target,
never JSON member order, labels, paths, transcript search, or a schema hash.
This is an access path for bookmark metadata, **not a second graph store**.
Metadata replacement, affected index rows, and bookmark revision change together.
Listing links does not need to read either endpoint's transcript.

New exact writer calls validate registered source identity and endpoint membership
for supported grains (initially Session/Message), failing without mutation on
missing/unavailable endpoints. Versioned import may preserve dangling historical
references explicitly; later endpoint deletion does not erase the bookmark.
Resolution distinguishes missing entity from unavailable source and unsupported
grain. Listing still shows the stored assertion/label without substituting a
similar Session. Explicit metadata/bookmark removal removes its outgoing
assertions/backlink results only; it never deletes the target Session. No upstream
foreign-key cascade, automatic inverse link, reparenting, transcript copy,
recursive traversal, RDF vocabulary, or rule evaluator is part of this slice.

Backlinks are complete only within the explicitly selected bookmark store(s),
not “all references everywhere.” Selecting external storage keeps source/store
identity separate. [summary0's source discipline](/.design/bookmarks/summary0.gpt6a.md#minimal-source-catalog-discipline)
still applies: profile labels/`--db` do not authenticate durable identity.

## Callable Operations: Three Independently Deliverable Cuts

| Cut | Capability and owner | Necessary prerequisites |
|---|---|---|
| **Read now, P1** | Cotail finite `session.get`, through an agent tool and shared read RPC | Existing trusted profile/query operation + small reviewed host adapter |
| **Exact write/readback, P1** | Exact bookmark creation/metadata replacement and outgoing/backlink lookup | Minimal catalog registration, selected store, Session/Message resolver, k=v codec/indexes, explicit writer enablement |
| **Deferred binder, P2** | Rekon next-response practice/observer + reviewed durable intent | Accepted lifecycle/fence/partial-output policy from the existing mark inquiry |

Neither all CLI migration, all report/capture grains, nor the deferred binder
blocks first read/exact tools. No consumer should invoke an LLM to browse links.
The same Cotail operations serve tools and ordinary client RPC calls.

### Verified machinery, not a new universal registry

[QueryRegistry](/packages/query-runtime/src/registry.ts#L95) manages typed query
instances with scoped acquisition/capability discovery; it does not define
serializable operation inputs, tool permissions, or an RPC dispatcher.
[nodeLogicalKyselyQueryFactory](/packages/query-kysely/src/runtime/registry.ts)
and its [integration test](/packages/query-kysely/test/registry-integration.test.ts)
already acquire the real logical world. The first adapter can use this factory
or direct scoped acquisition; registry-wide CLI migration is unnecessary.
[getSession](/packages/query-kysely/src/operations/resolve.ts#L53) is the exact,
metadata-only implementation to call, not CLI output parsing or copied SQL.

The [externalized subagent-control plugin](file:///home/rektide/src/opencode-subagent-control/README.md#host-compatibility)
is the relevant precedent: public tool registration with explicit host capability
requirements, not an implicit core patch. Its own required Session APIs do not
become prerequisites for Cotail's standalone SQLite read. Public
[OpenCode tools](https://opencode.ai/v2/docs/build/plugins#tools) and
[RPC](https://opencode.ai/v2/docs/build/plugins/rpc) support separate model-facing
registration and `ctx.rpc.register(Rpc.define(...))`; TUI clients use
`context.client.rpc(definition)`. RPC events are live-only; reads remain restart truth.

### Recommended smallest host for the current consumers

Use a thin **OpenCode server plugin**, with one shared operation bridge called
by `cotail_session_get` and `CotailRead.sessionGet` RPC. Keep SQLite/query code in
**Node 24+**, using a fixed one-request Node helper process initially: Cotail
depends on `node:sqlite`; neither direct import into the host's Bun runtime nor
sharing incompatible Effect versions is assumed safe. The helper calls domain
operations, not the human CLI. This costs process startup per call but avoids a
new daemon and lets existing Node code work unchanged. Parent authorization of
this tradeoff and a target-host fixture probe are required before implementation.

Proposed files: `src/tools/operations/session-get.ts`, `src/tools/contract.ts`,
`src/tools/host/request.ts`, and `packages/opencode-plugin/src/{index,rpc}.ts`.
`rpc.ts` exports only portable contracts, never Core/SQLite runtime dependencies.
An Effect plugin can scope subprocess acquisition/interruption for both callers;
the [public Effect tool](file:///home/rektide/src/opencode-term-v2/packages/plugin/src/effect/tool.ts)
and [RPC interfaces](file:///home/rektide/src/opencode-term-v2/packages/plugin/src/effect/rpc.ts)
exist in the inspected checkout. Verify actual cancellation/unload behavior in
the deployed SDK, rather than inferring it from a passed typecheck.

A Node stdio MCP host is a viable **alternative** for other agent clients:
the [official server example](file:///home/rektide/archive/modelcontextprotocol/servers/src/sequentialthinking/index.ts#L125)
uses `McpServer.registerTool` plus `StdioServerTransport`. It is not required for
the first OpenCode tool/RPC pair, and MCP tool availability is not Opensesser UI
transport. Do not implement both adapters just to justify a generic framework.

## Next Executable Tracer And Its Gate

After parent authorization, exercise the proposed helper directly:

```sh
node src/tools/host/request.ts --profile /path/to/fixture-profile.json
# stdin: {"schema":"cotail.call/v1","operation":"session.get","input":{"sessionID":"ses_child"}}
```

The host fixes the Node executable, helper path, profile, and optional locator
override. Tool/RPC inputs cannot provide filesystem paths, executable strings,
SQL, Kysely callbacks, or method names outside the allowlist. Use argument arrays
and bounded JSON stdin/stdout, not shell interpolation. One request returns a
versioned JSON result containing the canonical Session observation or a declared
error; diagnostics go to stderr. An unregistered read source is explicitly
`identityStatus: "selection-scoped"` in the envelope, never advertised as a
durable catalog identity. The exact writer must resolve/adopt catalog identity
and reread its target rather than persist that provisional read SourceKey.

Test the domain operation, real fixture helper process, and both adapter paths:
same parent/child result, not-found and schema errors, zero bookmark writes,
no implicit profile inspection, bounded output, malformed request/result,
cancellation/timeout/unload cleanup, and no stdout contamination. Verify public
tool/RPC registration in the intended installed host against disposable data;
do not deploy to the live service or claim an unverified SDK works. Reuse
`pnpm test`, root `pnpm exec tsgo --noEmit`, and package query checks as applicable.

Exact writer registration is a later explicit capability, absent by default.
Model-tool permission and client-RPC authorization are separate boundaries;
enabling one must not implicitly expose the other. The later acceptance tracer
is create exact Session bookmark + child/Message metadata → restart → outgoing
lookup/backlinks through the same domain and read RPC. Request IDs make retries
idempotent; changed payload reuse conflicts. Domain export/import and capture
growth remain separate work, not prerequisites to this first usable tool slice.

## Consumer And Ticket Alignment

Parent evidence: Opensesser currently injects only `client.session`; root-only
listing excludes children. No Cotail integration exists. A related-links view
needs typed read RPC plus **explicit target lookup**, not that root-list filter.
Keep client-scoped ordered selection and Session lookers separate from links;
following relationships must be explicit, not automatic recent-everywhere expansion.
The parent owns Opensesser/Rekon changes and consumer-specific details.

Reuse the bookmark epic/catalog/store/resolver/CLI issues; add
`cotail-bookmarks-metadata-links`. Create P1 `cotail-tools` with
`cotail-tools-read` and `cotail-tools-exact-write`; the latter depends on the read
adapter and metadata-links/resolver. Neither depends on `cotail-bookmarks-cli`,
`cotail-bookmarks-mark-intent`, or all future capture/report capabilities.
Promote the concrete catalog/store/resolver/metadata prerequisites to P1.
Keep runtime work open and implementation authorization separate from this plan.

## Cross-References

- [Bookmark index](/.design/bookmarks/index.md) preserves draft5/summary0 lineage;
  links are bookmark metadata, not a replacement Target or summary lifecycle.
- [Query runtime entry point](/.design/query-runtime/README.md) explains scoped
  acquisition; this is a concrete consumer, not a mandate for another registry.
- [Cotail README](/README.md#source-profiles) remains the shipped read-only
  contract; new tool/storage paths above are proposed, not current commands.
- [Rekon mementos brief](file:///home/rektide/src/rekon/design/session-mementos/brief0.gpt6a.md)
  supplies the cross-project selection/tool ownership split; the link ticket and
  patches memento add this human priority shift without accepting a graph system.
