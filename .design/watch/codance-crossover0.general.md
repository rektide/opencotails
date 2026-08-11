---
type: Research
title: Codance crossover for opencoattails watch
description: How Codance topic workflows, interaction records, and OpenCode events could enrich an append-only activity history and live ranked watch view.
tags: [opencoattails, watch, codance, opencode, activity, ranking, events]
status: draft
generated: { by: model:general, at: 2026-08-11T00:00:00Z }
sources:
  - id: codance-source
    resource: /home/rektide/src/codance
    title: Codance prototype and design corpus
    author: project:codance
  - id: opencode-linked-source
    resource: /home/rektide/archive/anomalyco/v2
    title: OpenCode V2 checkout linked by Codance
    author: organization:anomalyco
---

# Codance Crossover For `opencoattails watch`

## Situation

`watch` needs two deliberately different products over the same observations:

1. an append-only, history-style account of what happened; and
2. a continuously rewritten ranking of everything currently available.

Codance is relevant because its eventual domain is not merely session status. It
adds user intent, topic splitting, pending-input disposition, workflow recovery,
check-ins, and cadence decisions. Today, however, Codance is only a small
command-driven TUI plugin. The rich event and storage surfaces exist mostly in
the linked OpenCode host and in Codance design work, not in Codance runtime code.

The important integration rule is therefore: **treat Codance as a future source
of semantic activity, not as the present authority for session inventory.**
SQLite polling or another snapshot source can remain the bootstrap/fallback
while an event adapter progressively supplies richer, lower-latency facts.

## What Exists Now

### Topic transport is intentionally narrow

The implemented `TopicTransport` has only `get`, `fork`, `rename`, and `prompt`;
it is an orchestration seam, not an observation feed
([`/home/rektide/src/codance/src/topic/types.ts:55-72`](/home/rektide/src/codance/src/topic/types.ts#L55-L72)).
Its Promise-client adapter only forwards those calls and abort signals
([`/home/rektide/src/codance/src/topic/transport.ts:3-31`](/home/rektide/src/codance/src/topic/transport.ts#L3-L31)).

Two workflows exist:

- `seedTopic`: fork, optionally rename, then queue the selected prompt
  ([`/home/rektide/src/codance/src/topic/workflows.ts:136-148`](/home/rektide/src/codance/src/topic/workflows.ts#L136-L148)).
- `runTopicFork`: fork, optionally rename, optionally queue source continuation,
  then steer the selected prompt on the child
  ([`/home/rektide/src/codance/src/topic/workflows.ts:151-186`](/home/rektide/src/codance/src/topic/workflows.ts#L151-L186)).

Admissions carry useful semantic provenance: workflow, disposition, source
session/message, and fork session
([`/home/rektide/src/codance/src/topic/workflows.ts:67-82`](/home/rektide/src/codance/src/topic/workflows.ts#L67-L82)).
This metadata can later turn generic input events into activity such as “topic
fork started” or “source continuation parked,” but there is no stable workflow
ID yet.

### Hooks and commands exist, but observation hooks are unused

The plugin registers two global palette/slash commands through the `app` slot:
`opencodance.seed-topic`/`dance-seed` and
`opencodance.run-topic-fork`/`dance-fork`
([`/home/rektide/src/codance/src/plugin/index.ts:4-35`](/home/rektide/src/codance/src/plugin/index.ts#L4-L35)).
Commands paginate projected user messages, collect decisions through dialogs,
run the workflow, navigate, and reduce the result to a toast
([`/home/rektide/src/codance/src/plugin/commands.ts:30-74`](/home/rektide/src/codance/src/plugin/commands.ts#L30-L74),
[`/home/rektide/src/codance/src/plugin/commands.ts:93-129`](/home/rektide/src/codance/src/plugin/commands.ts#L93-L129)).
Successful partial outcomes are not retained after the toast.

The host plugin context already exposes typed event subscriptions, a reactive
session cache, durable storage, plugin pages, slots, tabs, and attention
([`/home/rektide/archive/anomalyco/v2/packages/plugin/src/tui/context.ts:29-95`](/home/rektide/archive/anomalyco/v2/packages/plugin/src/tui/context.ts#L29-L95),
[`/home/rektide/archive/anomalyco/v2/packages/plugin/src/tui/context.ts:367-415`](/home/rektide/archive/anomalyco/v2/packages/plugin/src/tui/context.ts#L367-L415)).
Codance currently subscribes to none of these events and persists no state.

### OpenCode already emits much richer activity than a session-row poll

Durable events include input admission/delivery/promotion, execution lifecycle,
step lifecycle, shell lifecycle, tool calls/results, retries, compaction, and
revert transitions. The public inventory is explicit
([`/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts:594-642`](/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts#L594-L642)).
Examples useful to ranking include:

- input state changes and execution start/end
  ([`/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts:155-218`](/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts#L155-L218));
- step finish reason, cost, tokens, and changed files
  ([`/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts:287-324`](/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts#L287-L324));
- tool identity, input, executed status, success, and failure
  ([`/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts:409-507`](/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts#L409-L507));
- retry attempt/error and compaction pressure
  ([`/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts:510-544`](/home/rektide/archive/anomalyco/v2/packages/schema/src/session-event.ts#L510-L544)).

The TUI itself demonstrates the intended event-driven pattern: it derives
running/idle from execution events
([`/home/rektide/archive/anomalyco/v2/packages/tui/src/context/data.tsx:763-795`](/home/rektide/archive/anomalyco/v2/packages/tui/src/context/data.tsx#L763-L795)),
and its session tabs fold family activity, pending work, permissions, and forms
into `busy`/`attention` state
([`/home/rektide/archive/anomalyco/v2/packages/tui/src/context/session-tabs.tsx:104-125`](/home/rektide/archive/anomalyco/v2/packages/tui/src/context/session-tabs.tsx#L104-L125)).

### Durability is split

The general event subscription is explicitly volatile: slow consumers can
overflow and disconnected consumers miss events
([`/home/rektide/archive/anomalyco/v2/packages/protocol/src/groups/event.ts:28-45`](/home/rektide/archive/anomalyco/v2/packages/protocol/src/groups/event.ts#L28-L45)).
Durable event envelopes do carry aggregate sequence, version, event ID, and
creation time
([`/home/rektide/archive/anomalyco/v2/packages/schema/src/event.ts:15-28`](/home/rektide/archive/anomalyco/v2/packages/schema/src/event.ts#L15-L28),
[`/home/rektide/archive/anomalyco/v2/packages/schema/src/event.ts:60-71`](/home/rektide/archive/anomalyco/v2/packages/schema/src/event.ts#L60-L71)).
An experimental per-session endpoint can replay after an exclusive sequence and
follow live events
([`/home/rektide/archive/anomalyco/v2/packages/protocol/src/groups/session.ts:628-645`](/home/rektide/archive/anomalyco/v2/packages/protocol/src/groups/session.ts#L628-L645)).

Plugin storage is durable local JSON with locked read-modify-write, atomic
replacement, and filesystem-watch synchronization
([`/home/rektide/archive/anomalyco/v2/packages/tui/src/context/storage.tsx:47-93`](/home/rektide/archive/anomalyco/v2/packages/tui/src/context/storage.tsx#L47-L93),
[`/home/rektide/archive/anomalyco/v2/packages/tui/src/context/storage.tsx:102-117`](/home/rektide/archive/anomalyco/v2/packages/tui/src/context/storage.tsx#L102-L117)).
Plugin IDs namespace keys automatically
([`/home/rektide/archive/anomalyco/v2/packages/tui/src/plugin/api.tsx:121-133`](/home/rektide/archive/anomalyco/v2/packages/tui/src/plugin/api.tsx#L121-L133)).
This is suitable for Codance interaction/workflow records, but it is local TUI
state, not a shared server fact.

## Codance Interaction Records

No concrete `InteractionRecord` type exists today. The design converges on
separate concepts:

- an intent artifact is captured user payload and origin;
- a maneuver is the user-approved multi-step outcome and write-ahead steps;
- a checkpoint is a durable boundary reference;
- a check-in is an interaction recording trigger, presentation level, and user
  decision;
- cadence state contains counters, snooze/suppression, last boundary, and
  observation confidence.

These distinctions are stated in
[`/home/rektide/src/codance/.design/initial-assessment/syn0.gpt56t.md:253-305`](/home/rektide/src/codance/.design/initial-assessment/syn0.gpt56t.md#L253-L305).
The workflow design specifically proposes append-only operation steps because a
single current-state record loses reconciliation evidence
([`/home/rektide/src/codance/.design/durable-workflows/init0.glm52.md:266-308`](/home/rektide/src/codance/.design/durable-workflows/init0.glm52.md#L266-L308)).
The cadence design likewise proposes append-only local records for every policy
decision and user response
([`/home/rektide/src/codance/.design/cadence-policy/init0.ds4f.md:402-417`](/home/rektide/src/codance/.design/cadence-policy/init0.ds4f.md#L402-L417)).

This is an excellent semantic source for `watch`, but it remains speculative
until Codance persists these records and exposes them outside the plugin.

## Integration Shape

### One history, separate projection

Normalize every source into an immutable activity envelope:

```ts
interface WatchActivity {
  readonly id: string;
  readonly occurredAt: number;
  readonly source: "snapshot" | "opencode-event" | "codance-interaction";
  readonly subject: { readonly kind: "session" | "workflow" | "checkin"; readonly id: string };
  readonly sessionID?: string;
  readonly type: string;
  readonly severity: "normal" | "attention" | "error";
  readonly summary: string;
  readonly cursor?: { readonly aggregateID: string; readonly seq: number };
  readonly data: unknown;
}
```

Append envelopes to the history view without coalescing. Separately reduce them
into `AvailableItem` records keyed by session/workflow/check-in. The ranking view
rerenders that projection; it must not reorder or rewrite history.

Codance workflow records should emit both intent and outcome facts. For example:
`fork.requested`, `fork.created`, `rename.failed`, `prompt.admitted`,
`workflow.needs-repair`, and `workflow.settled`. This exposes partial success
that is currently compressed into warnings
([`/home/rektide/src/codance/src/topic/types.ts:74-88`](/home/rektide/src/codance/src/topic/types.ts#L74-L88)).

### Ranking policy

Rank “everything available” by actionable state, not raw event frequency:

1. unanswered permission/form/question and Codance check-in awaiting decision;
2. failed or ambiguous maneuver needing repair;
3. failed/retrying session;
4. running session or fork, with most recent meaningful activity first;
5. pending/parked runnable input and available lifted intent;
6. recently completed session with unread activity;
7. idle session/checkpoint, recency ordered.

Within a tier, use deterministic tie-breakers: newest meaningful event, then
stable subject ID. Tool deltas and token updates should refresh detail but not
continually boost rank. Family aggregation should be explicit because the host
already treats root plus subagents as one busy/attention unit
([`/home/rektide/archive/anomalyco/v2/packages/tui/src/context/session-tabs.tsx:104-115`](/home/rektide/archive/anomalyco/v2/packages/tui/src/context/session-tabs.tsx#L104-L115)).

Cadence should modify rank only when it creates an actionable check-in. A raw
step-budget counter is diagnostic context, not itself “available work.” Codance’s
recommended first policy is opt-in, waits for idle, and presents a hint while
focused or attention while unfocused
([`/home/rektide/src/codance/.design/initial-assessment/syn0.gpt56t.md:156-169`](/home/rektide/src/codance/.design/initial-assessment/syn0.gpt56t.md#L156-L169)).

### Delivery stages

**Now:** keep SQLite/snapshot polling as inventory and restart truth. Give
snapshot-derived activities synthetic deterministic IDs so unchanged polls do
not append duplicates. Codance metadata found in projected/pending prompts can
decorate known sessions and link source/fork relationships.

**Near term:** add a Codance TUI event collector in `setup`, returning cleanup
functions as the built-in notification plugin does
([`/home/rektide/archive/anomalyco/v2/packages/tui/src/feature-plugins/system/notifications.ts:21-82`](/home/rektide/archive/anomalyco/v2/packages/tui/src/feature-plugins/system/notifications.ts#L21-L82)).
Append semantic interaction/workflow facts to Codance storage before effects;
publish them to `watch` through a narrow bridge such as JSONL/stdout, a local
socket, or a shared append file. Do not make `watch` scrape mutable plugin state
and infer transitions if Codance can emit them directly.

**Preferred eventual path:** connect `watch` to OpenCode’s generated client and
consume each known session’s durable `session.log({ after, follow: true })`,
persisting the per-aggregate sequence cursor. Use the volatile global stream for
discovery and ephemeral enhancement, then reconcile session inventory and logs
after reconnect. This replaces frequent SQLite polling for activity without
pretending that ephemeral usage/progress deltas are replayable.

**Later Codance enrichment:** expose a versioned semantic event contract for
check-ins, maneuvers, artifacts, and cadence decisions. Include stable workflow
IDs in admitted prompt metadata so server events and plugin records can be
joined. Codance’s current metadata lacks that identity, and its in-memory prompt
ID only survives one invocation
([`/home/rektide/src/codance/src/topic/workflows.ts:40-45`](/home/rektide/src/codance/src/topic/workflows.ts#L40-L45),
[`/home/rektide/src/codance/src/topic/workflows.ts:67-82`](/home/rektide/src/codance/src/topic/workflows.ts#L67-L82)).

## Boundaries And Risks

- Do not call the volatile global stream history. It is a live accelerator.
- Do not expose tool input/output indiscriminately; activity summaries need
  redaction and bounded payloads.
- Do not let high-volume deltas starve actionable ranking changes.
- Do not treat plugin storage as cross-machine or server-authoritative.
- Do not infer a completed Codance workflow from fork existence alone; partial
  rename/admission failures are normal.
- Do not let cadence suggestions dominate running or explicitly requested work.
- Pin the OpenCode version. Codance depends on a beta linked TUI contract
  ([`/home/rektide/src/codance/package.json:29-32`](/home/rektide/src/codance/package.json#L29-L32)).

## Recommendation

Build `watch` around a source-neutral append/reduce core now. Keep the current
poller as a snapshot adapter, then add OpenCode durable-log and Codance semantic
adapters independently. The durable log should become the high-fidelity account
of server activity; Codance should contribute the human meaning that server
events cannot know: why a topic split occurred, what decision is waiting, what
was parked, and which maneuver needs repair.

This preserves both desired surfaces: history remains an honest sequence of
observations, while the stacked view remains a policy-driven answer to “what can
I act on now?”
