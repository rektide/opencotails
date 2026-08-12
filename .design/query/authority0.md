---
type: StorageAuthorityDecision
title: Mixed V1 and V2 storage authority
description: Establishes session ownership, content selection, and message-count policy from the opencode migration contract and aggregate transition evidence.
resource: /query/authority0.md
tags: [cotail, query, opencode, sqlite, migration, authority, content, counts]
status: stable
generated: { by: model:openai/gpt-5.6, at: 2026-08-11T00:00:00Z }
verified: { by: aggregate-read-only-analysis, at: 2026-08-11T00:00:00Z }
stale_after: 2026-11-11
sources:
  - id: opencode-v1-migration
    resource: file:///home/rektide/archive/anomalyco/opencode/packages/core/src/database/v1-migration.ts
    title: Authoritative V1 to V2 migration implementation
  - id: opencode-session-projector
    resource: file:///home/rektide/archive/anomalyco/opencode/packages/core/src/session/projector.ts
    title: Authoritative V2 session projector
  - id: opencode-session-history
    resource: file:///home/rektide/archive/anomalyco/opencode/packages/core/src/session/history.ts
    title: Authoritative V2 history reader
  - id: opencode-session-revert
    resource: file:///home/rektide/archive/anomalyco/opencode/packages/core/src/session/revert.ts
    title: Authoritative V2 revert planner
  - id: opencode-migration-design
    resource: file:///home/rektide/archive/anomalyco/opencode/docs/design/v1-v2-database-migration.md
    title: V1 to V2 database migration design
  - id: production-database
    resource: file:///home/rektide/.local/share/opencode/opencode-local.db
    title: Read-only local opencode transition database
  - id: aggregate-queries
    resource: /.test-agent/query-builders/authority/README.md
    title: Reproducible aggregate-only authority analysis
---

# Mixed V1 And V2 Storage Authority

## Verdict

The failed rule, "any native message makes the whole session native," must not
be replaced by an ID-based union. The safe discriminator is the session's
projected owner row:

- a session present in `session_v2` is V2-owned; select content and counts only
  from `session_message`, including the authoritative result of zero rows;
- a session present only in legacy `session` is V1-owned; select content from
  `message`/`part` and count `message` rows; and
- if both layouts and legacy sessions exist while `migration.v1-v2` is absent or
  not `{"phase":"completed"}`, reject the database as actively/incompletely
  migrating rather than infer authority from partial rows.

This is per-session ownership with per-record replacement semantics inside the
V2 projection. It is not per-session message-presence precedence and not a
cross-layout record union. For a V2-owned session, matching message IDs confirm
lineage but do not authorize retaining unmatched V1 records.

Implementation may resume at adjudication step 8 under this policy. Steps 9 and
10 may follow only after the fixture and query-plan gates below pass. No further
storage-semantics investigation is required to start that work.

## Source-Backed Facts

The current files in `/home/rektide/archive/anomalyco/v2` at `ff34807e443c` and
`/home/rektide/archive/anomalyco/opencode` at `16fe54fc6731` are byte-identical
for the migration, projector, history, revert, and migration-design sources
used here.

- The migration decodes and sorts V1 messages and parts, then deliberately
  transforms them rather than copying rows
  (`packages/core/src/database/v1-migration.ts:169-220`). Ordinary messages
  reuse the V1 message ID; mixed synthetic input can add a derived ID; subtask
  messages can be omitted; compaction pairs can collapse to one row; assistant
  parts fold into `content[]` (`:221-391`). Sequence numbers are assigned only
  after filtering (`:390-424`).
- Each legacy session is processed in one transaction. That transaction inserts
  its `session_v2` owner row if needed, reads V1 rows, deletes the session's old
  `session_message` projection, inserts the transformed rows, and updates its
  event-sequence watermark (`:512-591`). The migration cursor update is in that
  same transaction (`:523-531`), and completion is persisted only after the
  loop (`:603-609`). Thus `session_v2` plus completed migration state can own a
  legitimate zero-row projection.
- The migration contract explicitly preserves V1 tables while replacing each
  session's V2 state and reuses ordinary V1 message IDs
  (`docs/design/v1-v2-database-migration.md:58-99`). It explicitly omits or
  collapses subtask and compaction records (`:101-108`, `:207-224`). Unmatched
  legacy IDs are therefore not automatically missing native data.
- Native history reads only `session_message`, ordered by `seq`; completed
  compaction can narrow runner history but does not switch back to V1
  (`packages/core/src/session/history.ts:15-71`).
- A committed revert deletes `session_message` rows at and after the boundary
  sequence (`packages/core/src/session/projector.ts:590-625`). It does not delete
  preserved V1 `message`/`part` rows. An ID union can therefore resurrect
  reverted records.
- Native message insertion uses the durable event sequence as `seq`
  (`packages/core/src/session/projector.ts:332-347`). Updates preserve the row's
  sequence (`:210-230`). Gaps are valid after deletion and imported V2 history
  can begin above zero.

The earlier statement that current V2 still projects V1 message/part events is
obsolete. The current projector contains no `SessionV1.Event.MessageUpdated`,
`MessageRemoved`, `PartUpdated`, or `PartRemoved` handlers; V1 history enters
`session_message` through the explicit migration above.

## Aggregate Evidence

The scripts in
[`authority/`](/.test-agent/query-builders/authority/README.md) opened
`~/.local/share/opencode/opencode-local.db` with `sqlite3 -readonly`, enabled
`PRAGMA query_only`, selected no sensitive values, and held a read transaction
per report. The summary snapshot observed completed migration state and:

| Measure | Count |
|---|---:|
| Legacy `session` rows | 5,254 |
| Native `session_v2` rows | 5,582 |
| Legacy `message` rows | 286,927 |
| Native `session_message` rows | 289,271 |
| Legacy `part` rows | 1,209,100 |
| Message IDs on both sides | 278,940 |
| IDs unique to V1 | 7,987 |
| IDs unique to V2 | 10,331 |
| Matching IDs with different session IDs | 0 |

All 5,254 legacy session IDs also had a `session_v2` row; 328 sessions were
native-only. Three V2-owned legacy sessions had zero native messages. Two of
those still had five V1 messages, proving that native row absence is a valid
authoritative result, not a V1 fallback signal.

Per-session ID-set patterns were:

| Pattern | Sessions | V1 rows | V2 rows | Overlap |
|---|---:|---:|---:|---:|
| Exact ID set | 3,972 | 137,324 | 137,324 | 137,324 |
| Native extension | 888 | 60,756 | 62,073 | 60,756 |
| Native-record-only | 328 | 0 | 8,510 | 0 |
| Legacy residue | 210 | 24,604 | 22,360 | 22,360 |
| Unique records on both sides | 181 | 64,238 | 59,004 | 58,500 |
| Legacy records but zero native records | 2 | 5 | 0 | 0 |
| Zero records in both layouts | 1 | 0 | 0 | 0 |

Matching-ID type mapping was 250,717 assistant-to-assistant, 27,696
user-to-user, 355 user-to-compaction, and 172 user-to-synthetic. All 278,940
matching IDs preserved creation time. 278,889 preserved update time; the 51
differences were 50 compactions and one assistant. This agrees with the source's
collapsed-record timestamp rules. Native type totals were 258,417 assistant,
28,306 user, 2,125 synthetic, 375 compaction, 32 system, 11 model-switched, and
5 agent-switched.

The 7,987 V1-only IDs affected 393 sessions. Aggregate classification directly
identified 37 compaction users, 391 paired compaction summaries, two subtask
users, and two paired subtask task assistants. The remaining 7,555 cannot be
attributed exactly without migration warnings or historical event state. Their
parts included 5,841 text, 415 reasoning, and 7,262 tool records, so retaining
them would materially alter search. Exact attribution is unnecessary for
authority because source semantics establish that V1 rows are preserved while
native projection rows may be omitted or later reverted.

The database retained no events, no native staged revert, and no retained
revert events. Two legacy session rows had non-null revert state while their
native owner rows did not. Therefore this snapshot cannot quantify historical
committed reverts or distinguish every deleted row from every migration
omission. It does show that legacy revert state is not authoritative after V2
ownership.

Native `seq` was strictly increasing in every one of 5,579 sessions with native
messages. 330 sessions were non-dense; 328 began above zero and 330 had gaps.
This supports ordering by `(session_id, seq)` but rejects assumptions that
`seq = 0..count-1`.

## Content Authority

V1 parts and V2 content cannot be unioned or deduplicated by content ID.

- Of V2 assistant content items, all 353,251 tool items had an `id`, while all
  199,137 reasoning and 79,049 text items lacked one. There is no cross-layout
  text/reasoning content key.
- For all 250,717 overlapping assistant messages, the ordered arrays of
  `(type,text)` for text/reasoning content exactly matched the transformed V1
  parts; zero differed.
- For overlapping user-to-user records without file attachments, all 26,015 of
  26,015 native text values exactly equaled visible, non-synthetic V1 text parts
  joined with blank lines. V1 part boundaries are intentionally absent in V2.
- All 172 overlapping user-to-synthetic records exactly matched the joined V1
  synthetic text.

The selected content policy is therefore whole-record selection by session
owner. A V2-owned session contributes only normalized V2 units: user text at the
message row, and assistant text/reasoning by `(seq, content-array position)`.
V1 parts contribute only for a V1-owned session. Do not union a matching V1
message's parts with V2 content and do not add V1-only message IDs to a V2-owned
session. V2 tool and shell normalization remain deferred as adjudicated.

## Count Authority

The selected compatibility count is:

- V2-owned session: count every `session_message` row, including control types;
- V1-owned session: count every `message` row; and
- zero native rows for a V2-owned session means zero.

This follows each version's canonical message relation. A conversational-turn
count restricted to user/assistant would be a new metric and must not silently
replace current history counts. Never add V1 and V2 counts, compare them for
equality, or count their ID union.

## Query Shapes

Capability detection must include `session_v2` and `kv`, not only message-table
presence. Build only branches whose physical tables exist.

The conceptual session root for a completed mixed database is:

```sql
SELECT v.id, 'v2' AS owner, v.time_created, v.time_updated
FROM session_v2 AS v
UNION ALL
SELECT s.id, 'v1' AS owner, s.time_created, s.time_updated
FROM session AS s
WHERE NOT EXISTS (SELECT 1 FROM session_v2 AS v WHERE v.id = s.id)
```

Content normalization then guards each source by owner:

```sql
-- V2 user text
SELECT sm.session_id, sm.id AS message_id, sm.seq, 0 AS position,
       'text' AS content_type, json_extract(sm.data, '$.text') AS text
FROM session_message AS sm
JOIN session_v2 AS v ON v.id = sm.session_id
WHERE sm.type = 'user'

UNION ALL

-- V2 assistant text/reasoning; json_each.key is the stable array position.
SELECT sm.session_id, sm.id, sm.seq, cast(item.key AS integer),
       json_extract(item.value, '$.type'), json_extract(item.value, '$.text')
FROM session_message AS sm
JOIN session_v2 AS v ON v.id = sm.session_id
JOIN json_each(sm.data, '$.content') AS item
WHERE sm.type = 'assistant'
  AND json_extract(item.value, '$.type') IN ('text', 'reasoning')

UNION ALL

-- V1 fallback only when no V2 owner exists.
SELECT p.session_id, m.id, p.time_created, 0,
       json_extract(p.data, '$.type'), json_extract(p.data, '$.text')
FROM part AS p
JOIN message AS m ON m.id = p.message_id
JOIN session AS s ON s.id = p.session_id
WHERE NOT EXISTS (SELECT 1 FROM session_v2 AS v WHERE v.id = s.id)
  AND json_extract(p.data, '$.type') IN ('text', 'reasoning')
```

History count lowering should correlate to the owner rather than add sources:

```sql
CASE owner
  WHEN 'v2' THEN (SELECT count(*) FROM session_message sm WHERE sm.session_id = root.id)
  ELSE (SELECT count(*) FROM message m WHERE m.session_id = root.id)
END
```

Apply the recent cutoff inside the selected subquery. Preserve separate session
selection and message-count cutoffs. For a pure V1 database omit V2 branches; for
a pure V2 database omit V1 branches. In a mixed database, first require the
completed migration marker.

## Candidates Considered

| Policy | Decision | Reason |
|---|---|---|
| Add both table counts/content | Reject | Double-counts 278,940 matching IDs. |
| Native rows present per session, else V1 | Reject | Three V2-owned sessions legitimately have zero native rows; two retain V1 rows. |
| Native user/assistant present, else V1 | Reject | Control-only and zero-row projections are valid; controls transform legacy messages. |
| ID union, V2 wins matching IDs | Reject | Resurrects deliberately omitted and potentially reverted V1 records; V2-only derived/native IDs must not validate V1 residue. |
| Match content IDs across layouts | Reject | V2 text/reasoning items have no IDs and user text collapses part boundaries. |
| Globally prefer V2 whenever table exists | Reject | A mixed database can contain V1-only owner rows during migration or external coexistence. |
| `session_v2` owner, V1 fallback, completed mixed migration | Select | Matches the atomic migration boundary, preserves zero-row authority, and handles native-only sessions. |

## Fixture Requirements

Before step 8 lands, executable fixtures must cover:

- pure V1 and pure V2 databases with absent opposite-layout tables;
- completed mixed migration with exact overlap, native extensions, native-only
  sessions, V1 residue, both-side unique IDs, and a V2-owned zero-row session;
- user text joined from multiple V1 parts, entirely and partly synthetic input,
  assistant content arrays with multiple text/reasoning entries, and stable
  `(seq, array position)` evidence order;
- a collapsed compaction and omitted subtask pair proving V1-only IDs do not
  leak into V2-owned search or counts;
- a committed revert leaving V1 rows behind while native rows at/after the
  boundary are absent;
- nonzero starting sequences and sequence gaps;
- mixed layout with absent/running/incomplete migration state, which must fail
  clearly rather than return partial results; and
- matching IDs with transformed types/timestamps plus duplicate-ID/session
  integrity failures.

Step 9 fixtures must independently assert all-row counts, recent cutoffs,
zero-message sessions, unlimited `0`, and unchanged rendering for each owner.
Step 10 still requires representative `EXPLAIN QUERY PLAN`, strict checking,
minimum-Node execution, and byte-compatible CLI output.

## Risks And Limits

- This policy depends on current opencode migration atomicity and `session_v2`
  ownership. Re-audit if that migration or table split changes.
- The real database is live. Exact summary and content reports are transactionally
  consistent individually, but native-only activity can increase between them.
- The snapshot cannot attribute 7,555 unmatched legacy rows to a specific
  historical omission/revert event. Do not use that unknown category to invent
  restoration behavior.
- Reading during migration is deliberately unsupported. Cursor-aware partial
  reads are possible in theory but conflict with imported-V2 collision behavior
  and are unnecessary because opencode blocks startup on migration.
- Searchable tool/shell canonicalization remains unresolved. This decision only
  authorizes V2 user text and assistant text/reasoning.

## Cross-References

- [`implementation0.md`](/query/implementation0.md) records the earlier stop and
  the count mismatch that prompted this investigation.
- [`adjudication0.md`](/query/adjudication0.md) defines steps 8-10 and the
  transition authority gates this decision now satisfies.
- [`v2.md`](/v2.md) establishes the broad V2 schema and ordering model, but its
  legacy-projector description predates the explicit migration implementation
  audited here.
- [`authority/README.md`](/.test-agent/query-builders/authority/README.md)
  documents the reproducible, aggregate-only analysis.
