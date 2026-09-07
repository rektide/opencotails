---
type: ImplementationBrief
title: Exact bookmarks and links — next callable capability
description: Pre-audit proposed reading order, gated on a fresh GX recovery of existing bookmark guidance before any implementation handoff.
resource: /.design/bookmarks/implementation0.gpt6a.md
tags: [bookmarks, links, tools, implementation, source-identity]
status: draft
generated: { by: "model:openai/gpt-6-astra#xhigh", at: 2026-09-06 }
stale_after: 2026-10-06
extensions:
  ticket: cotail-bookmarks
sources:
  - { resource: "urn:opencode:session:ses_f86cfeb14ffev9dX8mwiS0sZIm", title: Human request to prioritize bookmarks after read-only review, with GX fixes and an explicitly authorized Astra bookmark handoff }
  - { resource: /.design/bookmarks/links-tools0.gpt6a.md, title: Key/value links and independently deliverable tool capabilities }
  - { resource: /.design/bookmarks/summary0.gpt6a.md, title: Selected storage and source identity; deferred intent remains separate }
  - { resource: /.design/bookmarks/runtime-probe0.gpt6a.md, title: Evidence superseding the Node-helper recommendation }
  - { resource: /.design/bookmarks/callable-read0.gpt6a.md, title: Implemented shared read operation and actual host constraints }
---

# Commission and gate

**New human gate:** a fresh GX must dredge Cotail's last seven days of bookmark
history plus existing local guidance, including this conversation's trail.
That audit is running in `ses_f86308e82ffeWe0qHb6pgb1IVp`, tracked by
`cotail-bookmarks-guidance-audit` (blocking the source-catalog prerequisite).
The parent must review
its findings before any bookmark implementation or Astra handoff. This brief was
saved as the **pre-audit candidate** in `6e66a5ce`; it must not outrank recovered
decisions merely because it is newer. The separate read-only GX cleanup may
finish, but does not release this bookmark gate.

The human identifies **bookmarks as the next major tool win**. The first read-only
tool/RPC is implemented; GX owns any review fixes. Do not begin dependent bookmark
implementation until that read checkpoint has been reviewed and the parent has
explicitly released the bookmark handoff. The human authorized an Astra bookmark
agent for that next task, not unrestricted Astra/general delegation elsewhere.

This brief consolidates current direction for the existing `cotail-bookmarks`
epic and its P1 prerequisites. It is not another bookmark schema or a declaration
that every detailed proposal is accepted.

## Read these in order

1. [Callable read receipt](/.design/bookmarks/callable-read0.gpt6a.md) and
   [actual plugin usage](/packages/opencode-plugin/README.md): reusable operation,
   public tool/RPC, cancellation and error behavior. Read any subsequent GX review
   fixes before coding; the receipt's original pending-review status is historical.
2. [Key/value links](/.design/bookmarks/links-tools0.gpt6a.md): bookmark target is
   the source endpoint; explicit Target-valued metadata carries destination links;
   arbitrary descriptive JSON is not traversed. Detailed cardinality/codec choices
   remain the first design checkpoint.
3. [Selected storage and source catalog](/.design/bookmarks/summary0.gpt6a.md#selectable-storage-without-widening-query-authority),
   especially [minimal identity discipline](/.design/bookmarks/summary0.gpt6a.md#minimal-source-catalog-discipline):
   source and bookmark-store identity differ; profile labels are not durable IDs.
4. [Runtime probe](/.design/bookmarks/runtime-probe0.gpt6a.md): use the verified
   in-process Promise/plain-data seam. It supersedes links-tools0's helper-process
   recommendation. Do not reintroduce a helper/daemon from that older paragraph.
5. [Draft5](/.design/bookmarks/draft5.gpt56.md) only for retained Target/capture and
   resolution concepts. Its XDG-only/never-write-the-source-file clauses are
   superseded in the current tickets; they must not drive implementation.

## The representative ticket path

```text
cotail-bookmarks-source-catalog
  → cotail-bookmarks-store
  → cotail-bookmarks-resolve
  → cotail-bookmarks-metadata-links
  → cotail-tools-exact-write

cotail-tools-read → cotail-tools-exact-write
```

The actual Beads graph additionally records direct store/resolver dependencies;
the diagram is the useful implementation order, not a replacement graph.
The next task is **not** full CLI management, export/import, all capture grains,
next-response binding or a universal namespace resolver.

## First architectural checkpoint: durable foundation

Before writing the storage implementation, return a concise concrete proposal
for the owned schema, registration/adoption interface and transaction scope.
Parent review should settle what the first slice makes possible, not every
future extension. Then implement a fixture-backed vertical foundation:

- Register/adopt one explicit source and expose the assigned durable identity.
  Preserve the distinction from the existing read tool's
  `identityStatus: "selection-scoped"`. Its profile-derived Target must **not**
  simply be persisted as a registered bookmark target.
- Initialize only Cotail-owned `rektide_cotail_*` objects in the selected store.
  Default store selection follows the resolved source DB; an explicit alternate
  store remains possible. Source registration and bookmark-store initialization
  must compose without a circular package/module dependency.
- Create/get one exact Session bookmark using the existing canonical target and
  source query machinery. Define a stable request retry key and conflicting reuse.
  Retain optional capture support only where already justified; no content capture
  by default and no fabricated summary classification.
- Keep writer acquisition separate from ordinary query acquisition and disabled
  until explicitly selected/enabled. Missing default source, namespace conflict,
  unsupported format, permissions and busy failures must not silently create or
  select an alternative store.
- Demonstrate that source/catalog/bookmark identities survive reopening the
  fixture. No OpenCode-owned rows, schema, indexes, triggers, migration metadata,
  `user_version` or `application_id` may be changed by our writer.
- Do not extrapolate read-runtime success into proven writer concurrency. Before
  exposing writes inside the host, exercise successful co-located writes and
  bounded busy behavior with an active disposable host/source. A synchronous
  SQLite lock wait can block the host event loop; report a demonstrated conflict
  before choosing async retries, a worker or process isolation. The read probe
  did not settle that writer-specific tradeoff.

The store transaction can make **our records** atomic. Do not claim an atomic
transaction across separately selected source databases. Source validation is an
observation of exact endpoint existence; later deletion is a normal resolvable
missing target, not a reason for automatic pruning or retargeting.

## Following checkpoint: exact links, then tools

Once the durable foundation is reviewed, add exact Session/Message resolution
and bookmark k=v metadata with the agreed wire shape. Exercise self, child and
cross-source targets. Derive outgoing/backlink access from the bookmark-owned
metadata; do not maintain independently mutable inverse bookmarks or another
graph authority. Preserve exact Message identity under optional Session-scoped
queries, and never pass explicit children through a root-only list filter.

Then expose the reviewed exact operations through the existing public host
adapter and shared read RPC. Clarify how an agent obtains **registered** targets
without mistaking provisional read identities for durable ones; do not conceal
this behind a convenience cast. Operator paths/source configuration remain outside
model inputs. Write-tool enablement and write-RPC authorization are separate from
read access. Opensesser needs the read interface, not mutation authority.

The useful acceptance example is: **register source → create exact bookmark →
set a child/Message reference value → reopen → query outgoing links and backlinks
through the same domain/RPC operations**. No live installation is part of that
example. Parent checkpoints continue at the consequential interface changes.

## Preserve these boundaries

- Native Session/Message identity comes from Cotail's existing Address/Target
  algebra; source registration supplies the durable SourceKey.
- Summary purpose is explicit intent, not an effect of a key named `summary`.
  Any exact-summary eligibility policy still needs explicit review; do not import
  unresolved next-response rules into ordinary bookmarks.
- Future Beads/document reference values preserve their native authority. Their
  broader namespace work is not a prerequisite for this Session/Message slice.
- Follow existing source/profile trust: no implicit executable discovery, schema
  reinspection, profile refresh, default-channel guessing or global registry build.
- Fix only owned code. Do not patch OpenCode or widen dependency/tool exposure to
  conceal host incompatibility; report concrete evidence at the checkpoint.
- Commit each coherent stage with its ticket IDs in the body, export the current
  Beads snapshot explicitly before receipt commits, and preserve predecessors
  before review revisions. No pushes, live DB writes or plugin installation.

## Cross-references

- [Bookmark index](/.design/bookmarks/index.md) — current guidance and preserved
  historical choices; this brief supplies an execution reading order.
- [Opensesser consumer](file:///home/rektide/src/opensesser/design/bookmark-links/consumer0.gpt6a.md)
  — exact child handling, source-safe navigation and bounded read requirements.
- [Rekon native-reference application](file:///home/rektide/src/rekon/design/session-mementos/references0.gpt6a.md)
  — common reference direction without a second owner of ticket or document state.
