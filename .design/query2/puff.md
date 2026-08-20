---
type: DesignNote
title: The scope of the work
description: A short case for the read-scope execution contract — provenance as claims, execution as leases, honesty as interface design.
resource: /query2/puff.md
tags: [cotail, query, execution, design, provenance]
status: draft
generated: { by: model:anthropic/claude, at: 2026-08-20T00:00:00Z }
stale_after: 2026-11-20
sources:
  - id: execution-prd
    resource: /query2/design.md
    title: Cotail query execution contract PRD
---

# The Scope of the Work

The [execution contract](/query2/design.md) is 1,277 lines long. It did not have
to be. Underneath the seventeen requirements, the interruption matrix, and the
fifteen open decisions is one move with wide consequences:

**Replace a function with a scope.**

Today the seam between cotail's logical queries and SQLite is a function:
`(sql, parameters) => rows`. It has no memory, no duration, no identity, and no
obligations. A function cannot keep a promise; it can only keep returning. The
design replaces it with a read scope — a handle that owns a connection lease,
one read transaction, a minted identity, and a cleanup destiny. Everything else
in the PRD is what falls out of taking that one move seriously.

## A function has no duties; a scope has jurisdiction

When execution is a function, every caller is an owner by default. Each
operation has to know which connection it is using, when a transaction begins,
what a snapshot is, when to close an iterator, and what a busy error means.
The read scope moves those duties across the seam:

- The **provider** keeps the connection, the transaction, the right to mint
  provenance, cleanup, and the failure taxonomy.
- The **caller** keeps the only things a caller should decide: which rows, and
  what policy.

What is left on the caller's side of the seam is three methods — `all`,
`stream`, `explain` — sitting on top of lease, transaction, pin, redaction, and
conformance machinery. That is a deep module in the old sense: a small
interface over steep semantics. The complexity does not disappear. It gets one
address.

## Provenance is a claim, and claims need an authority

Here is the quiet scandal of the current code: direct search mints
`` `direct:${randomUUID()}` `` *before* executing anything and stores it as
`sourceSnapshot`. The value has the shape of a claim about database state and
the content of a correlation tag. Nobody is lying, but the type is — it says
"snapshot" over a value that only names one invocation of one function.

The fix is an authority rule: **only the thing that actually pinned the
transaction gets to say what was observed.** Once minting belongs to the
provider, one overloaded string decomposes into four honest names:

| Name | Answers | Discipline |
|---|---|---|
| `ReadScopeID` | "same observation?" | Always present; claims nothing beyond equality |
| `SourceRevision` | "which state did I see?" | **Absence must remain absence** |
| `observedAt` | "when was the scope published?" | Not "when the data became true" |
| `ProjectionRevision` | "which version of this entity?" | Entity-level, not scope-level |

The second row is the whole game. The discipline of not inventing a watermark,
an Event sequence, or a wall-clock timestamp because a field wants filling is
what makes every future consumer — durable bookmarks, staleness detection,
honest cache invalidation — possible at all. You cannot build comparison on a
token that never meant anything.

## Leases, not handles

Most execution APIs are handle-shaped: they hand you a connection and expect
it back. Ownership is baked into the interface. The read scope is lease-shaped.
Standalone mode owns everything it touches. The future hosted adapter joins a
transaction OpenCode already opened, on OpenCode's connection, under OpenCode's
semaphore, and may release only what was granted — never the connection
itself. Provenance even records the difference: `owned` versus `joined`.

This is the single move that makes hosting the query world inside OpenCode
possible without bolting a second driver onto a native handle. The same three
methods run over wildly different resource realities, and the seam does not
care which.

## Options that refuse to lie

The interruption table in the PRD is mostly a refusal. Synchronous `node:sqlite`
blocks the JavaScript thread; no deadline can abort a step already in flight.
So the contract declines to name a `timeout` option at all until an interface
exists that can tell the truth about one. The same posture recurs everywhere:

- Deadline expiration fails explicitly rather than silently truncating rows.
- A stream may never transparently restart after emitting — duplication is
  forbidden, not papered over.
- Concurrent use of one read scope raises a typed `read-scope-busy` error
  instead of queueing forever.
- Cleanup defects surface in the Effect Cause rather than being flattened into
  recoverable query errors.

One principle throughout: **explicit failure over silent degradation.** An
option the implementation cannot honor is worse than no option.

## Invariants in the type, not the convention

A multi-stage operation — qualify candidates, hydrate live rows, decode — holds
its "these statements saw the same world" invariant today only by discipline.
Nothing structurally prevents each stage from reopening. With a read scope,
sharing a snapshot *is* sharing a handle; the wrong shape is not discouraged,
it is not expressible through the public interface. The streaming helper makes
the same move for lifetimes: "open a scope, grab an iterator, close the scope,
consume later" is a bug the API cannot represent, because stream consumption
and scope closure are tied together by construction.

## The suite is the contract

The conformance suite is exported, not internal. A provider author implements
one seam and runs one suite; the hosted ticket's acceptance is literally "run
it and pass." Convenience helpers must delegate to the same read-scope
machinery, so ease of use can never fork into a second execution path. Prose
contracts drift; executable ones at least fail loudly.

## The snapshot is a free rider

It is worth saying plainly: the stable snapshot — one read transaction pinned
across statements, unaffected by concurrent WAL writers — is real, tested, and
almost incidental. It is what falls out when lifetime and ownership are made
explicit. If you do not care about consistency races, the design still pays
out in honest claims, a hostable seam, options that cannot lie, structural
invariants, bounded memory (backpressure instead of materialization), and
traces that are private by default rather than by diligence.

The current executor is a function. The read scope is a jurisdiction map —
every resource an owner, every claim an authority, every lifetime an edge.
The consistent read is just the scenery on the way through.

## Cross-References

- [Cotail query execution contract](/query2/design.md) is the full PRD this
  note distills; requirements EXEC-1 through EXEC-5 are its spine.
- [Cotail V2 relational query world](/.design/query/design3.gpt56.md) defines
  the logical relations and evidence model whose execution seam this is.
- Bead `cotail-query-execution-contract` remains the tracker state until the
  PRD's epic-and-children restructure is accepted.
