---
type: Design
title: "cotail future applications — producers and consumers of stored composites"
description: "Companion to draft2. Captures the broader brainstorm of future cotail features that the Pointer + Composite + Store primitives would enable. Explicitly out of scope for the bookmark ticket; this file exists so the ideas aren't lost when the active design tightens."
resource: /home/rektide/src/opencoattails/.design/bookmarks/applications.glm52.md
tags: [cotail, brainstorm, future, producers, applications]
status: draft
generated: { by: agent:glm-5.2, at: 2026-08-04T00:00:00Z }
sources:
  - id: draft1
    resource: file:///home/rektide/src/opencoattails/.design/bookmarks/draft1.glm52.md
    title: "the draft whose applications section was rolled back out of draft2"
---

# cotail future applications — out-of-scope brainstorm

## Why this file exists

draft2 of the bookmark design deliberately scopes down to: land the
`Pointer`/`Composite`/`Store` primitives, ship `bookmark` + `bookmarks ls`,
refactor existing commands onto the new primitives in follow-ups.

That tightening rolled back a broader brainstorm from draft1 about *other*
producers that could write Composites to the same store, and *other* consumers
that could read them. The user said those ideas are interesting but don't
belong in the active design. They belong here, so we don't lose them and so
the active design isn't tempted to scope-creep into them.

**Nothing in this file gates draft2.** Each item is a candidate for its own
ticket once the primitives are landed.

## Producer candidates (things that write Composites)

A "producer" is anything that builds a `Composite` and calls `store.save()`.
The bookmark command is the first; these are the others we've thought about:

### `fork-point` (auto-producer)

A watcher (probably a `cotail watch` subcommand) that polls for sessions with
a non-null `parent_id` (v1) or `fork_session_id` (v2) and emits a Composite
with `intent.tags: ["fork-point"]` the first time it sees each fork. Effect:
every fork is annotated even when the user forgets to mark it.

Pairs naturally with a future `cotail tree <rootId>` view that lays a session
tree out by lineage.

### `compaction-boundary` (auto-producer)

opencode sets `session.time_compacting` when it compacts context. A producer
that watches for that field transitioning from null → value emits a
Composite capturing the prompt/reply just before context was lost. Effect:
compaction becomes visible and reverse-searchable, instead of silently
shrinking what the model can see.

### `decision-point` (bookmarked, tagged)

Not a new producer — just a bookmark with `tags: ["decision-point"]`. The
distinction is convention, not code. Documented as a recommended tag in
help text; future `bookmarks ls --tag decision-point` becomes a project's
decision log for free.

### `milestone` (bookmarked, tagged)

Same shape: bookmark + tag. The "goal-line" marker.

### `review-request` (bookmarked, tagged, or future producer)

A Composite tagged for human review, pulled by an external consumer (GitHub
issue creator, Slack notifier, email digest). The Composite is the stable
address everything refers back to.

### `handoff` (cross-instance)

A producer that creates a Composite specifically to seed another opencode
instance's context. The Composite id is the "handoff token" the next agent
receives in its first prompt; a future `cotail handoff <id>` materializes
the snapshot into a prompt prefix.

### `cost-snapshot` (Layer 2 extension)

A producer that fills a future `cost: CostSnapshot` slot on Composite (not
currently defined) — cost and token counts at a moment. Enables
"this decision cost $2.40 in tokens" queries by diffing two snapshots.

## Consumer candidates (things that read Composites)

### `cotail bookmarks ls`

Already in draft2 — the obvious one.

### `cotail tree <rootId>`

Render a session tree (root → forks → forks-of-forks) with Composites
annotated at their points. Cross-fork narrative becomes navigable. The
`rootSessionId` field on `SessionDescriptor` is the join key.

### `cotail journal` / `cotail today`

Auto-generated digest: list every Composite created today, grouped by
`descriptor.directory` (per-project), then by `rootSessionId` (per-thread).
A daily narrative without the user writing it.

### `cotail diff <id-a> <id-b>`

Two Composites → a view of what diverged between them. Useful for
"why did this fork go a different direction".

### `cotail export <id>`

Export a Composite as a self-contained markdown transcript chunk. The
`SessionDescriptor` + `ContentSnapshot` carry enough to render a readable
snippet without re-querying the opencode DB.

### `cotail replay <id>`

Use a Composite as a restore-target for a new opencode session. The user
gets a fresh fork pre-loaded with the snapshotted context. (Agent state
isn't restorable, but the *prompt prefix* is.)

### External integrations

- GitHub issue body for `review-request` tags.
- Daily digest email / Slack message from `journal`-style queries.
- A web UI rendering the store as a navigable timeline.

## Throughline

Every item above is **"read or write a Composite at an address"**. Once the
primitives land, each one is a thin producer or consumer — no new
infrastructure, just a new flavor of fill-in-the-slots or render-the-slots.
That's the leverage the user is after; the work is getting the primitives
right (draft2's job), then letting applications compose on top.

## Status

Each item is a **future ticket candidate**, not a commitment. They're listed
here so:

- draft2 doesn't have to enumerate them.
- A future planning session can pick which to promote to tickets.
- We can spot-check the primitives against them ("would `cost-snapshot` need
  a slot that isn't on `Composite` today?") — if so, that's a signal about
  the primitive shape, even though the producer isn't built.

The active design remains [`draft2.glm52.md`](draft2.glm52.md).
