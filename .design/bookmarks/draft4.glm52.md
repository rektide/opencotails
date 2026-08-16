---
type: Design
title: "cotail Pointer + lineage (draft4) — corrected live-DB audit + capability detection"
description: "Assessment of draft3 plus a revised design. Corrects draft3's v1/v2 column audit against cotail's actual live DB (summary_* exists; agent/model/cost/tokens/fork_*/path/metadata/workspace_id/time_suspended do NOT), drops the version-string branching in favor of column-capability detection, fixes the recursive CTE so it runs against the v1-shaped DB today, and resolves the half-and-half naming. Keeps draft3's access-pattern split (SessionInfo = one SELECT; SessionLineage = derived) and Composite slotting, which are the right core."
resource: /home/rektide/src/opencoattails/.design/bookmarks/draft4.glm52.md
tags: [cotail, cli, pointer, bookmark, lineage, session, schema, capability-detection]
status: draft
generated: { by: agent:glm-5.2, at: 2026-08-05T00:00:00Z }
sources:
  - id: draft3
    resource: file:///home/rektide/src/opencoattails/.design/bookmarks/draft3.glm52.md
    title: "preceding draft — access-pattern split + SessionLineage (this draft corrects its audit)"
  - id: draft2
    resource: file:///home/rektide/src/opencoattails/.design/bookmarks/draft2.glm52.md
    title: "Pointer + Composite + Store primitives"
  - id: opencode-v2-session-schema
    resource: file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session.ts
    title: "canonical v2 Session.Info (effect Schema struct; location nests directory+workspaceID)"
  - id: opencode-v2-fork-boundary
    resource: file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session-fork.ts
    title: "canonical v2 ForkBoundary union (before | through)"
  - id: opencode-v2-session-sql
    resource: file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/sql.ts
    title: "canonical v2 SessionTable — every column"
  - id: opencode-v2-session-from-row
    resource: file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/info.ts
    title: "canonical v2 row → Session.Info decoder"
  - id: opencode-v2-projector
    resource: file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/projector.ts
    title: "where v2 sets fork_session_id and nulls parent_id at fork time"
  - id: opencode-v1-session-info
    resource: file:///home/rektide/archive/anomalyco/v1/packages/opencode/src/session/session.ts
    title: "canonical v1 Session.Info (parentID only; but type-model DOES carry agent/model/cost/tokens/summary)"
  - id: cotail-live-db
    resource: sqlite://~/.local/share/opencode/opencode.db
    title: "cotail live DB — v1-shaped row, 2205 sessions, 473 dirs, 494 with parent_id, summary on 2111, share/compacting/archived on 0"
  - id: cotail-session-report-epic
    resource: file:///home/rektide/src/opencoattails/.beads/issues.jsonl
    title: "authoritative layered SessionInfo breakdown this design aligns with"
---

# cotail Pointer + lineage (draft4)

## Stage-setting

draft3 landed the important structural call: **one type per access pattern**
— `SessionInfo` (one indexed SELECT by id) vs `SessionLineage` (derived
walks). That split is right and this draft keeps it. draft3 also added
`forkPoint[]` (ancestor chain) and `forkOffs[]` (children), both good shapes.

But draft3's **factual grounding is off** in ways that matter for "starting to
move." The v1/v2 column audit is wrong about several fields, the lineage SQL
references columns that don't exist in the live DB, and the version-string
branching (`"v1" | "v2"`) doesn't match what the `version` column actually
holds. This draft corrects all of that and tightens scope to what is
shippable against the live DB *now*, while keeping the type shape
forward-compatible with a future v2/opencode-2 DB.

A one-line prompt for the direction of inquiry here:

> Reconcile draft3's `SessionInfo`/`SessionLineage` design with cotail's
> actual live SQLite schema; make the lineage SQL run today; pick one naming
> convention and stop half-aligning with upstream.

## Assessment of draft3 — what holds, what doesn't

**Holds (keep):**
- Access-pattern split: `SessionInfo` (direct row) vs `SessionLineage`
  (derived). Directly answers the prior "interfaces should match access
  patterns" feedback.
- `forkPoint[]` as a self→root chain with per-hop detail; `forkOffs[]` as the
  inverse. Good algebra.
- `ForkBoundary` re-declared literally from upstream (`before` | `through`
  with `messageID`), with a `@see` rather than a re-implementation.
- `Composite` slots; `lineage` as a lazy peer to `info`.
- Open decisions on depth cap, batched time lookups, snapshot cost/tokens at
  bookmark time, OR tag semantics — all well-judged.

**Doesn't hold (fix):**
1. **The v1/live-DB audit is wrong.** See table below.
2. **The lineage SQL won't run on the live DB.** It references
   `fork_session_id`/`fork_boundary`, which don't exist there.
3. **`version: "v1" | "v2"` is ungrounded.** The `version` column holds opaque
   build strings (`0.0.0-dev-202601200913`, `0.0.0--202603280146`, `local`,
   …), not the literals `"v1"`/`"v2"`. cotail must branch on **column
   presence**, not a version string.
4. **Naming is half-and-half.** draft3 lowercases `parentId`/`forkSessionId`/
   `projectId`/`workspaceId` but keeps `messageID` uppercase, while claiming to
   "mirror upstream." Upstream is uniformly capital-ID
   (`parentID`/`sessionID`/`projectID`/`workspaceID`/`messageID`). The hybrid
   is the worst of both — pick one.
5. **`location` nesting is quietly flattened.** Upstream v2 `Session.Info`
   nests `directory` + `workspaceID` under `location: Location.Ref` and renames
   `path` → `subpath`. draft3 flattens these to top-level fields, which is a
   reasonable listing-oriented choice but is *not* "mirroring upstream." Be
   honest about it.

## The live-DB reality (corrected audit)

This is the single most important correction. The live cotail DB
(`~/.local/share/opencode/opencode.db`) has this `session` shape:

```
id, project_id, parent_id, slug, directory, title, version, share_url,
summary_additions, summary_deletions, summary_files, summary_diffs,
revert, permission,
time_created, time_updated, time_compacting, time_archived
```

**Present columns:** id, project_id, parent_id, slug, directory, title,
version, share_url, summary_{additions,deletions,files,diffs}, revert,
permission, time_{created,updated,compacting,archived}.

**Absent columns** (draft3 assumed present, at least for v2; many are absent
even on the live v1 DB): `workspace_id`, `fork_session_id`, `fork_boundary`,
`path`, `metadata`, `cost`, `tokens_{input,output,reasoning,cache_read,
cache_write}`, `agent`, `model`, `time_suspended`.

**Live coverage** (2205 sessions, 473 directories):

| column | populated rows |
|---|---|
| `parent_id` | 494 / 2205 |
| `summary_files` | 2111 / 2205 |
| `share_url` | 0 / 2205 |
| `time_compacting` | 0 / 2205 |
| `time_archived` | 0 / 2205 |

### Where draft3 mislabeled fields

| field | draft3 said | reality |
|---|---|---|
| `summary_*` | "v2-only direct columns" | **exists on the live v1 DB**, 2111 rows populated. Available *today*. |
| `agent`, `model`, `cost`, `tokens_*`, `metadata`, `path`, `workspaceID` | "v2-only" (implied absent on v1) | present in v1's **type model** (`v1/.../session.ts:224-244`) but **not in cotail's live DB** — this DB predates those migrations. They will be null for *all* current rows. |
| `fork_session_id`, `fork_boundary` | "v2-only" | correct that they're absent on the live DB; but this means **the entire fork-aware lineage is forward-compat scaffolding today** — only `parent_id` walking is real now (494 sessions). |
| `version` | `"v1" \| "v2"` literal union | opaque build strings. Already typed as `string` in shipped `session-info.ts`. Keep it `string`. |

### Implication

Of the ~20 fields draft3 adds to `SessionInfo`, only **7 are readable on the
live DB today**: `shareUrl`, `summary{additions,deletions,files,diffs}`,
`revert`, `permission`, `timeCompacting`, `timeArchived`. (And of those,
`shareUrl`/`timeCompacting`/`timeArchived` are populated on *zero* live rows —
they're real columns but currently empty.) The remaining ~13 (`agent`,
`model`, `cost`, `tokens`, `forkSessionId`, `forkBoundary`, `workspaceId`,
`path`, `metadata`, `timeSuspended`) are **forward-compat scaffolding**: typed
on `SessionInfo`, always null until cotail reads a DB that has the columns.

This is fine — types are cheap, and the shape is stable for the future — but
the design must be honest that it's scaffolding, and the **query layer must
detect column presence** rather than assume a version.

## Capability detection, not version strings

`SessionInfo` fields map to columns that may or may not exist. cotail already
ships a `version: string` that's opaque. The right primitive is a **column
capability set** resolved once per DB open:

```ts
// src/opencode/db-capabilities.ts (NEW)
export interface DbCapabilities {
  has: (column: string) => boolean;
  readonly present: ReadonlySet<string>;
}

export function detectCapabilities(db: DatabaseSync, table = "session"): DbCapabilities {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  const present = new Set(cols.map((c) => c.name));
  return { has: (c) => present.has(c), present };
}
```

The query builder then selects `COALESCE`-safe column lists: a guaranteed
core (`SELECT id, title, directory, …` — the columns that always exist) plus
optional columns added when `caps.has("agent")` etc. `mapRow` fills absent
fields with `null`. This is one `PRAGMA` per open — negligible cost, and it
makes the same code path serve the live v1-shaped DB and a future v2 DB
without a version-string lie.

The `version: string` field stays (it's the opencode build tag, useful for
display), but **no branching keys off it.**

## Naming: pick one convention

Two coherent options. draft3 did neither.

- **(A) cotail-camelCase, consistently.** `parentId`, `projectId`,
  `messageId`, `timeCreated`. Matches what cotail *already ships* in
  [`/src/opencode/session-info.ts`](/src/opencode/session-info.ts) (the JSON
  shape is already `parentId`/`projectId`/`timeCreated`). `ForkBoundary`'s
  field becomes `messageId`, with a `@see` to upstream. Internally consistent;
  no JSON break.
- **(B) upstream capital-ID, consistently.** `parentID`, `projectID`,
  `messageID`, `workspaceID`, `timeCreated`. Matches opencode exactly.
  Breaks cotail's current `--json` field names (acceptable pre-1.0 per
  house style, but it *is* a break).

**Recommendation: (A).** The shipped shape is already camelCase, the user
already consumes it, and cotail is a *listing/reporting* tool that flattens
`location` and renames `subpath`→`path` anyway — it is not a faithful mirror
of upstream, and pretending otherwise (draft3's hybrid) causes exactly the
confusion the user pushed back on. Be a cotail shape, cite upstream in
`@see`, move on. (If the user prefers strict upstream alignment, take (B) and
accept the one-time JSON rename.) See open decision #1.

## Revised type design

### `ForkBoundary` — unchanged from draft3 (correct)

Literal re-declaration of upstream
([`session-fork.ts:6-9`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session-fork.ts)):

```ts
export type ForkBoundary =
  | { type: "before"; messageID: string }
  | { type: "through"; messageID: string };
```

Under convention (A) the field would be `messageId`; under (B) it stays
`messageID`. Shown here in upstream form since that's its origin.

### `SessionInfo` — direct row fields, nullable, version-agnostic

Extends the shipped 9-field type. Every added field is `| null` because the
column may not exist on this DB. Field order follows the
[`cotail-session-report`](file:///home/rektide/src/opencoattails/.beads/issues.jsonl)
epic's layer numbering.

```ts
// src/opencode/session-info.ts (extended)
export interface SessionInfo {
  // layer 1 — core identity (existing, always present)
  id: string;
  title: string;
  directory: string;                  // the project directory; first-class for listing
  slug: string;
  projectId: string;
  parentId: string | null;            // continuation lineage; the ONLY lineage column on the live DB today
  version: string;                    // opaque opencode build tag (e.g. "0.0.0-dev-..."), NOT "v1"|"v2"
  timeCreated: number;
  timeUpdated: number;

  // layer 2 — run (column may be absent → null)
  agent: string | null;
  model: { id: string; providerID: string; variant?: string } | null;

  // layer 3 — cost (column may be absent → null); mutable, snapshot at bookmark time
  cost: number | null;
  tokens: {
    input: number; output: number; reasoning: number;
    cache: { read: number; write: number };
  } | null;

  // layer 4 — vcs summary (PRESENT on live DB; 2111/2205 rows populated)
  summary: {
    additions: number | null; deletions: number | null;
    files: number | null; diffs: unknown | null;   // FileDiff.LegacyInfo[]; opaque to cotail
  } | null;

  // layer 5 — fork lineage (columns ABSENT on live DB → always null today; forward-compat)
  forkSessionId: string | null;       // v2 fork_session_id
  forkBoundary: ForkBoundary | null;  // v2 fork_boundary

  // layer 6 — share (column present, 0 rows populated on live DB)
  shareUrl: string | null;

  // layer 7 — lifecycle (time_compacting/time_archived present, 0 populated; time_suspended absent)
  timeCompacting: number | null;
  timeArchived: number | null;
  timeSuspended: number | null;       // v2-only column; absent on live DB

  // v2 location fields (flattened from upstream's `location` + `subpath`)
  workspaceId: string | null;
  path: string | null;                // upstream `subpath`; relative path within directory

  // free-form / opaque
  metadata: Record<string, unknown> | null;
  revert: unknown | null;
  permission: unknown | null;
}
```

**Honesty notes in JSDoc, per field:** each field's doc states (a) the
snake_case column, (b) whether the column exists on a v1-shaped DB, (c) the
canonical `@see`. Example:

```ts
/**
 * v2 `fork_session_id`. The explicit-fork parent; distinct from `parentId`
 * (continuation). ABSENT on a v1-shaped DB → always null there.
 * @see opencode v2 SessionTable.fork_session_id — packages/core/src/session/sql.ts:34
 * @see opencode v2 Session.Info.fork.sessionID — packages/schema/src/session.ts:32 */
forkSessionId: string | null;
```

### `SessionLineage` — derived; honest about what's computable today

Same shape as draft3, but the doc is explicit that on the live DB **only the
`parent_id` chain is real** — `fork`-kind hops with non-null `boundary` appear
only once cotail reads a DB that has `fork_session_id`/`fork_boundary`.

```ts
// src/opencode/session-lineage.ts (NEW)
export interface SessionLineage {
  rootSessionId: string;
  /** self-first chain: [immediate parent, …, root]. forkPoint[0] is the nearest ancestor. */
  forkPoint: ForkHop[];
  /** sessions that branched off from this one (children, either parent-link or explicit fork). */
  forkOffs: ForkOff[];
}

export interface ForkHop {
  sessionId: string;                  // == COALESCE(child.forkSessionId, child.parentId)
  kind: "fork" | "parent";            // "fork" only possible when fork_session_id column exists AND is set
  boundary: ForkBoundary | null;      // non-null only for kind === "fork"
  time: number | null;                // boundary message's time_created; null when no boundary
}

export interface ForkOff {
  sessionId: string;
  boundary: ForkBoundary | null;
  time: number | null;
}
```

### SQL — runs against the live DB today, and against v2 tomorrow

The recursive walk must not reference columns that may not exist. Two forms,
selected by capability:

```ts
// when caps.has("fork_session_id")  → v2/opencode-2 shape
const v2Walk = `
  WITH RECURSIVE chain(id, parent_id, fork_session_id, fork_boundary, depth) AS (
    SELECT id, parent_id, fork_session_id, fork_boundary, 0
    FROM session WHERE id = ?
    UNION ALL
    SELECT s.id, s.parent_id, s.fork_session_id, s.fork_boundary, c.depth + 1
    FROM session s JOIN chain c
      ON s.id = COALESCE(c.fork_session_id, c.parent_id)
    WHERE (c.parent_id IS NOT NULL OR c.fork_session_id IS NOT NULL)
      AND c.depth < 100                       -- hard cap (open decision #3 from draft3)
  )
  SELECT * FROM chain ORDER BY depth;
`;

// when !caps.has("fork_session_id")  → live DB today (parent_id only)
const v1Walk = `
  WITH RECURSIVE chain(id, parent_id, depth) AS (
    SELECT id, parent_id, 0 FROM session WHERE id = ?
    UNION ALL
    SELECT s.id, s.parent_id, c.depth + 1
    FROM session s JOIN chain c ON s.id = c.parent_id
    WHERE c.parent_id IS NOT NULL AND c.depth < 100
  )
  SELECT * FROM chain ORDER BY depth;
`;
```

Children (one indexed lookup; the `OR parent_id = ?` arm serves v1 children,
the `fork_session_id = ?` arm is included only when the column exists):

```sql
-- v2 shape
SELECT id, fork_boundary, time_created FROM session
  WHERE fork_session_id = ? OR parent_id = ? ORDER BY time_created;
-- v1 shape (live DB today)
SELECT id, NULL AS fork_boundary, time_created FROM session
  WHERE parent_id = ? ORDER BY time_created;
```

Per-hop and per-child `time` (boundary message's `time_created`) is a batched
`IN (?)` lookup against `message` (v1) / `session_message` (v2) — null when
there is no boundary (all v1 hops; v2 `parent` continuations). Batched into a
single round-trip per direction (draft3 open decision #4, kept).

Cycle protection is the `depth < 100` guard in the recursive term (draft3's
cap recommendation, now actually in the SQL).

## `Composite` — unchanged from draft3

```ts
export interface Composite {
  pointer: Pointer;                   // always
  info?: SessionInfo;                 // direct-row lookup (renamed from draft2's "descriptor")
  lineage?: SessionLineage;           // derived walks; lazy
  counts?: SessionCounts;
  content?: ContentSnapshot;
  snippet?: SearchSnippet;
  intent?: Intent;                    // bookmark-only
}
```

Most producers fill `info` and stop. `lineage` is for ancestry-aware
consumers (`bookmarks ls --root <id>`, a future `cotail tree`).

## Scope to ship now

To actually move, land in this order (each step independently reviewable):

1. **`detectCapabilities`** (`src/opencode/db-capabilities.ts`) + a
   capability-aware column list for `SessionInfo`. Extend
   [`/src/opencode/session-info.ts`](/src/opencode/session-info.ts) to the
   full nullable shape; `mapRow` reads present columns, nulls the rest.
2. **`SessionLineage` + the two SQL walks** (`src/opencode/session-lineage.ts`),
   selected by `caps.has("fork_session_id")`. Ship with `parent_id`-only live
   data; the fork-kind hops are dormant until a v2 DB appears.
3. **`Pointer` + `Composite`** (`src/pointer/types.ts`) — the slots above.
4. **`bookmark` + `bookmarks ls`** on `Composite`, via the store from draft2.
   Existing `search`/`history`/`get-session` migrate afterward (one per
   commit), per draft2's additive strategy.

Steps 1–2 are the corrective work this draft asks for; 3–4 are draft2's
unchanged plan.

## Open decisions (carried + resolved)

1. **Naming convention.** (A) cotail-camelCase everywhere (`parentId`,
   `messageId`) — *recommended*; matches shipped JSON, no break. (B) upstream
   capital-ID everywhere (`parentID`, `messageID`) — strict alignment, breaks
   current JSON once. **draft3's hybrid is rejected.** Decision needed.
2. **v1 fork conflation.** Keep v1's `parent_id` as `parentId` only (truthful)
   and let the CTE `COALESCE` at walk time. *Recommendation: yes — do not
   mirror `parent_id` into `forkSessionId` on v1; that lies about what v1
   knew.* (carried from draft3, endorsed)
3. **`forkPoint` ordering.** Self-first (`[parent, …, root]`) makes
   `forkPoint[0]` the nearest ancestor — best for "who's my parent" queries.
   A future `cotail tree` *renderer* may want root-first, but that's a render-
   time reverse, not a data-shape decision. *Recommendation: self-first in the
   type; renderers reverse if needed.* (carried, endorsed)
4. **Depth cap.** 100, enforced in the recursive CTE (`depth < 100`), warn on
   stderr rather than throw. (carried, now in SQL)
5. **Eager vs batched `time` lookups.** Batched — one `IN (?)` per direction.
   (carried, endorsed)
6. **Cost/token fields — snapshot or live.** Snapshot at bookmark time (frozen
   point-in-time record); `--live` re-looks up. (carried, endorsed)
7. **Layer 8 (live HTTP) fields.** Out of scope here; owned by
   [`cotail-http-discovery`](file:///home/rektide/src/opencoattails/.beads/issues.jsonl).
   (carried)

## Out of scope (unchanged)

- Refactoring `search` / `history` / `get-session` onto `Composite` —
  follow-up commits.
- Other producers beyond `bookmark` — see
  [`applications.glm52.md`](applications.glm52.md).
- CLI framework migration. `bookmarks rm` / `search` / etc.

## References

- [`draft3.glm52.md`](draft3.glm52.md) — preceding draft; this one corrects
  its live-DB audit and SQL.
- [`draft2.glm52.md`](draft2.glm52.md), [`draft1.glm52.md`](draft1.glm52.md),
  [`draft0.glm52.md`](draft0.glm52.md),
  [`applications.glm52.md`](applications.glm52.md) — full history.
- [`/src/opencode/session-info.ts`](/src/opencode/session-info.ts) — the seed
  type this draft extends (and whose camelCase convention drives naming
  decision (A)).
- [`v2/packages/schema/src/session.ts`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session.ts) —
  canonical `Session.Info` (note: nests `directory`/`workspaceID` under
  `location`, renames `path`→`subpath`).
- [`v2/packages/schema/src/session-fork.ts`](file:///home/rektide/archive/anomalyco/v2/packages/schema/src/session-fork.ts) —
  canonical `ForkBoundary`.
- [`v2/packages/core/src/session/sql.ts`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/sql.ts) —
  canonical v2 `SessionTable`.
- [`v2/packages/core/src/session/info.ts`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/info.ts) —
  canonical row decoder.
- [`v2/packages/core/src/session/projector.ts`](file:///home/rektide/archive/anomalyco/v2/packages/core/src/session/projector.ts) —
  where fork events set `fork_session_id` and null `parent_id`.
- [`v1/packages/opencode/src/session/session.ts`](file:///home/rektide/archive/anomalyco/v1/packages/opencode/src/session/session.ts) —
  canonical v1 `Session.Info` (type model carries agent/model/cost/tokens/
  summary, but cotail's live DB lacks the migration that persists them).
- `cotail-session-report` epic in
  [`.beads/issues.jsonl`](/.beads/issues.jsonl) — the authoritative layered
  breakdown this design aligns with.
