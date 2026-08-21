---
type: Design
title: Durable references over canonical observations
description: Replacement bookmark design that retires Pointer and Composite, reuses the V2 query world's Target and Observation model, and narrows bookmark-owned work to durable intent, typed capture, source relocation, persistence, and resolution.
resource: /.design/bookmarks/draft5.gpt56.md
tags: [cotail, bookmarks, references, capture, source-catalog, session-report]
status: draft
generated: { by: model:openai/gpt-5.6, at: 2026-08-21T00:00:00Z }
stale_after: 2026-11-21
sources:
  - id: bookmark-draft4
    resource: /.design/bookmarks/draft4.glm52.md
    title: Previous Pointer, SessionInfo, lineage, and Composite design
  - id: query-world
    resource: /.design/query/design3.gpt56.md
    title: V2 relational query world, Target, Observation, and bookmark model
  - id: session-report
    resource: /.design/session-report/full-query-pass0.gpt56.md
    title: Canonical Session report and operation redesign
  - id: query-execution
    resource: /.design/query2/design2.gpt56.md
    title: Scoped query execution and truthful read provenance
  - id: source-catalog-requirement
    resource: /.design/query2/design.md
    title: Source catalog requirement preceding durable bookmarks
---

# Durable References Over Canonical Observations

## Status And Supersession

This draft supersedes bookmark drafts 0 through 4 as the active implementation
direction. Those drafts remain useful design lineage, but they predate the V2
logical query world and the canonical Session operation pass.

The old wave discovered several durable distinctions that survive:

- identity is not a descriptor;
- live data is not a frozen capture;
- a bookmark's identity is not its target's identity;
- continuation and fork lineage are different facts; and
- user intent is not query evidence.

It also proposed a parallel query architecture that is no longer needed. Cotail
now has hierarchical `Address`, source-qualified `Target`, read-provenanced
`Observation`, logical V2 relations, checked address mapping, evidence products,
and a canonical Session report underway. Bookmark work must consume those
modules, not recreate them under new names.

## Why The Previous Design Is Mostly Obsolete

| Previous concept or work | Current owner | Disposition |
|---|---|---|
| `Pointer` / `PointInSession` | `Address` and `Target` | Delete. A moment that has durable identity is a Message or content Address; bookmark creation time is not target identity. |
| `SessionDescriptor` / extended `SessionInfo` | canonical `SessionReport` | Delete. One shared report projection and decoder serves lookup, history, search, lineage, and capture. |
| `Composite` optional slots | operation-specific products | Delete. History activity, search evidence, lineage, and captures remain distinct typed products rather than one sparse bag. |
| `SessionCounts` slot | history activity facet | Subsumed by `SessionHistoryItem.activity`. |
| `SearchSnippet` slot | direct evidence | Subsumed by `DirectEvidence` and document observations. |
| custom lineage walks and `forkPoint` / `forkOffs` | `cotail_lineage_edge` and child analysis | Subsumed. Preserve typed continuation/fork edges, depth bounds, cycles, and dangling facts there. |
| v1/v2 capability detection | V2 source validation and logical relations | Delete. V1-only databases are rejected; commands do not branch on physical columns. |
| command migrations onto `Composite` | Session operation redesign | Delete. Lookup, history, and search migrate to canonical Session observations. |
| custom output records | shared command output specifications | Delete. JSONL, TSV, and Arrow are generated at the presentation seam. |
| pluggable TSV/Turso store registry | no current owner | Reject for now. One adapter would make the seam hypothetical; two speculative backends would multiply policy before requirements exist. |
| bookmark note, tags, durable ID, capture, listing | bookmark domain | Keep. These are user-owned facts absent from OpenCode. |
| source relocation and unavailable-source resolution | source catalog | Keep and make prerequisite work. |
| current/changed/missing resolution | bookmark resolver | Keep, but make it honest about whether a comparable capture exists. |

Draft4's live-database audit is historical evidence only. Its V1 assumptions,
physical `session` table, deleted file paths, nullable forward scaffolding, and
whole-database measurements do not constrain the V2-only implementation.

## Revised Product Boundary

A bookmark is a durable, user-owned reference to a cotail `Target`, with optional
typed capture and intent.

```ts
interface Bookmark<C extends BookmarkCapture = BookmarkCapture> {
  readonly bookmarkID: BookmarkID;
  readonly target: Target;
  readonly createdAt: number;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly capture?: C;
}
```

The bookmark does not contain a second pointer, descriptor, lineage tree, count
bag, or snippet bag. Its target selects identity. Its capture records a product
that an existing operation observed. Its note and tags record why a person kept
it.

### Typed Captures, Not Composite Slots

Captures are a closed, versioned wire union. Each variant owns its comparison
guard and payload schema.

```ts
type BookmarkCapture =
  | SessionReportCapture
  | DocumentEvidenceCapture;

interface SessionReportCapture {
  readonly schema: "cotail.session-report.capture/v1";
  readonly capturedAt: number;
  readonly target: Target<SessionAddress>;
  readonly report: SessionReport;
  readonly guard: {
    readonly updatedAt: number;
  };
}

interface DocumentEvidenceCapture {
  readonly schema: "cotail.document-evidence.capture/v1";
  readonly capturedAt: number;
  readonly target: Target<DocumentAddress>;
  readonly field: DocumentField;
  readonly excerpt: string;
  readonly revision: ProjectionRevision;
}
```

The persisted capture deliberately omits `ReadScopeID`. A read-scope ID proves
that several live observations came from one pinned read; it is not a durable
source revision and cannot detect later changes. `capturedAt` says when the
record was made. The variant guard says what can actually be compared later.

The initial bookmark command creates Session bookmarks and captures a
`SessionReport` by default. Content-bearing document capture is explicit because
prompts, reasoning, tool input, shell output, and evidence excerpts can be
sensitive.

### Session-Report Scope Growth

The Session report epic gains a capture operation because bookmarks are not its
only consumer. End-session closures, handoffs, exports, and future audit records
also need one stable, serializable Session product.

That operation:

- resolves and reads one Session under one `LogicalRead`;
- uses the canonical report projection and decoder;
- converts the live Session observation into `SessionReportCapture`;
- records `lifecycle.updatedAt` as the comparison guard;
- returns a typed capture without storing it; and
- does not capture transcript content, child trees, or search evidence by
  default.

Operation-specific richer artifacts compose this capture rather than adding
optional slots to `SessionReport`. For example, a closure artifact can contain a
Session report capture, child usage analysis, produced-artifact links, and a
human closure report without turning ordinary Session lookup into a closure
query.

## Durable Source Identity Comes First

`SourceKey.sourceID` is currently caller supplied and often set to values such as
`"cli"` or `"fixture"`. Such values are adequate for one process but cannot be
persisted as durable identity.

The source catalog owns:

- stable cotail-assigned source IDs;
- one or more current locators for an OpenCode database;
- explicit relocation after a database moves;
- duplicate-path and duplicate-identity detection;
- multiple configured OpenCode databases;
- last-seen metadata sufficient for diagnostics; and
- unavailable-source resolution.

An absolute path is a locator, not identity. Read-scope provenance is not source
identity. The catalog never mutates the OpenCode database to install an ID.

Source fingerprinting and relocation policy require a focused design. Until that
lands, bookmark persistence must not silently store the process-local `"cli"`
source key as if it were durable.

## Resolution Semantics

Resolution loads the bookmark, resolves its source through the catalog, and
dispatches to a resolver for the target Address grain.

```ts
type BookmarkResolution<C extends BookmarkCapture = BookmarkCapture> =
  | { readonly kind: "found"; readonly bookmark: Bookmark; readonly live: Observation<Address, unknown> }
  | { readonly kind: "current"; readonly bookmark: Bookmark<C>; readonly capture: C; readonly live: Observation<Address, unknown> }
  | { readonly kind: "changed"; readonly bookmark: Bookmark<C>; readonly capture: C; readonly live: Observation<Address, unknown> }
  | { readonly kind: "missing"; readonly bookmark: Bookmark }
  | { readonly kind: "source-unavailable"; readonly bookmark: Bookmark; readonly source: SourceKey };
```

`found` is required for a live bookmark without a comparable capture. Calling it
`current` would claim a comparison that never happened. Captured bookmarks can
resolve to `current` or `changed` according to their variant guard. Missing and
source-unavailable remain distinct.

Resolution never silently relocates a target to “similar” content. Recovery or
fuzzy search may offer candidates in a separate operation; accepting a candidate
creates an explicit new bookmark or retarget event.

## Persistence

Start with one cotail-owned local SQLite database under the XDG data directory.
Do not write the OpenCode database. Do not introduce a store registry, remote
default, TSV authority, or plugin seam before a second concrete adapter exists.

The local database should be organized by domain rather than as one generic
record table:

```sql
create table source_catalog (...);

create table bookmark (
  bookmark_id text primary key,
  source_id text not null,
  address_kind text not null,
  address_json text not null,
  session_id text,
  project_directory text,
  created_at integer not null,
  note text,
  capture_schema text,
  capture_json text,
  foreign key (source_id) references source_catalog(source_id)
);

create table bookmark_tag (
  bookmark_id text not null references bookmark(bookmark_id) on delete cascade,
  tag text not null,
  primary key (bookmark_id, tag)
);

create index bookmark_created_idx on bookmark(created_at desc, bookmark_id desc);
create index bookmark_source_idx on bookmark(source_id, created_at desc);
create index bookmark_session_idx on bookmark(source_id, session_id, created_at desc);
create index bookmark_project_idx on bookmark(project_directory, created_at desc);
create index bookmark_tag_idx on bookmark_tag(tag, bookmark_id);
```

`session_id` is extracted from Session-rooted Addresses and
`project_directory` from a Session report capture when present. These bounded,
indexed projections support the initial filters without extracting every JSON
capture. Tags use a normalized relation so `any` and `all` semantics have
predictable plans. The schema does not denormalize an unbounded copy of
`SessionReport` merely to avoid decoding captures.

Portability comes first through explicit JSONL export/import. A remote synced
adapter can later create a real persistence seam and conformance suite. Turso is
an option at that point, not the assumed default today.

The summary cache and future index are other cotail-owned data domains. They may
share database acquisition/configuration once their lifecycle requirements are
known, but bookmark tables do not become a generic key-value store for them.

## Initial Operations And CLI

The bookmark module exposes operations before commands:

- create a Session bookmark from `SessionReportCapture` plus normalized intent;
- list bookmarks with deterministic keyset pagination;
- get one bookmark by ID;
- resolve one bookmark against live source data;
- delete one bookmark explicitly; and
- export/import versioned JSONL.

Initial filters are creation range, source, Session target, project directory
captured in a Session report, and tags. Tag semantics must be explicit (`any` or
`all`) in the request rather than hidden in repeated flag behavior.

CLI naming should use one command group, such as `cotail bookmark create`,
`list`, `show`, `resolve`, `remove`, `export`, and `import`. Exact spelling can be
settled with the CLI redesign; the domain operations do not depend on it.

All machine output uses the shared output-specification module from the Session
operation pass. Bookmark rendering does not define another JSON/TSV/Arrow stack.

## Relationship To Closures, Handoffs, And Other Applications

The applications document mixed several distinct products under `Composite`.
They now separate cleanly:

- **decision point / milestone / review request:** ordinary bookmarks whose tags
  and note carry intent;
- **end-session closure:** a structured closure artifact that links a Session
  report capture and may itself be bookmarked;
- **handoff:** an explicit artifact containing selected context and references,
  not a bookmark subtype;
- **tree / child analysis:** live lineage operations, optionally referenced by a
  closure capture;
- **journal / today:** a query over bookmarks, closures, and Session reports;
- **cost snapshot:** already present in `SessionReportCapture.usage`, with deltas
  computed between captures rather than a new Composite slot;
- **export:** serializers over typed captures and artifacts; and
- **replay:** a future operation consuming an explicit handoff/context artifact,
  not pretending a bookmark restores agent state.

This is broader product composition but a smaller bookmark module.

## Delivery Cuts

1. **Capture-ready Session reports:** add and test `SessionReportCapture` under
   the Session report epic.
2. **Source catalog:** design stable source IDs, locators, relocation, duplicate
   handling, and unavailable-source behavior.
3. **Bookmark domain and local schema:** add IDs, intent normalization, typed
   capture codecs, migrations, and local SQLite lifecycle.
4. **Create and list:** persist Session bookmarks and expose deterministic listing
   through shared output specifications.
5. **Resolve:** implement target-grain dispatch and honest found/current/changed/
   missing/source-unavailable states.
6. **Management and portability:** show, remove, JSONL export, and import.
7. **Integrations:** connect end-session/closure only after its artifact contract
   is designed; do not make bookmark failure fatal to closure.

## Verification

- Capture codecs round-trip every schema version and reject unknown required
  fields without guessing.
- Session capture uses the canonical report and a real `updatedAt` guard.
- Read-scope IDs are never treated as durable revision tokens.
- Source relocation is explicit and duplicate-safe.
- Resolution tests cover found, current, changed, missing, unavailable source,
  and unsupported capture schema.
- Listing is deterministically paged and filters tags with declared any/all
  semantics.
- Source, Session, project, creation-time, and tag filters use bounded indexed
  projections rather than full capture-JSON scans.
- Content-bearing capture is opt-in and access-policy tested.
- OpenCode databases remain read-only.
- JSONL export/import preserves bookmark IDs, targets, intent, and captures.

## Explicitly Rejected

- Reintroducing `Pointer` beside `Address`/`Target`.
- Reintroducing `Composite` beside operation-specific products.
- Treating bookmark creation time as a point inside Session identity.
- Migrating search/history/get-session onto bookmark types.
- V1 source adapters or physical-column capability branching.
- Persisting arbitrary `Observation.read.readScopeID` as a change detector.
- Capturing prompt/reply text by default.
- Shipping two persistence adapters to justify a speculative store interface.
- Defaulting personal durable data to a remote service.
- Silent fuzzy retargeting.

## Open Decisions

1. What source fingerprint is stable enough to support relocation without writing
   identity into OpenCode's database?
2. Should the first cotail-owned SQLite database host bookmarks and the summary
   cache under separate domain migrations, or should each domain own a file?
3. Should bookmark IDs use a cotail-prefixed time-sortable format or UUIDv7?
4. Which Session changes should make a report capture `changed`: any
   `updatedAt` movement initially, or a canonical report fingerprint once proven?
5. Which Address grains are supported by the first resolver beyond Session and
   Document?
6. Does deletion hard-delete intent, or should the local store retain explicit
   tombstones for synced adapters that may arrive later?

## Cross-References

- [Canonical Session reporting](/.design/session-report/full-query-pass0.gpt56.md)
  supplies the Session observation and capture payload instead of a bookmark-owned
  descriptor.
- [V2 query-world design](/.design/query/design3.gpt56.md) supplies Address,
  Target, Observation, evidence, and the original four-state bookmark model this
  draft refines with `found` for uncaptured bookmarks.
- [Scoped query execution](/.design/query2/design2.gpt56.md) supplies truthful
  same-read provenance but intentionally does not supply durable source revision.
- [Source-catalog requirement](/.design/query2/design.md) establishes stable
  source identity and relocation as prerequisite work.
- [Bookmark draft4](/.design/bookmarks/draft4.glm52.md) is the immediately
  superseded design. Its Session fields and lineage work move to the canonical
  report and lineage relations; its intent/capture concerns survive here.
- [Future applications](/.design/bookmarks/applications.glm52.md) remains an idea
  inventory, reclassified above into bookmarks, closures, handoffs, live
  operations, and serializers rather than generic Composite producers.
- `cotail-end-session` is a downstream closure/handoff consumer, not evidence for
  widening the bookmark record into a universal artifact.
