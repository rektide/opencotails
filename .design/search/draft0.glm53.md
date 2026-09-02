---
type: Design
title: Search core completion draft
description: Gap analysis of cotail search against the logical document model it already projects, with a physically-informed scope for filling in field modes, combinators, and paging before growing new product areas.
resource: /.design/search/draft0.glm53.md
tags: [cotail, search, documents, witnesses, modes, core]
status: draft
generated: { by: model:zai/glm-5.3-max, at: 2026-09-02T00:00:00Z }
stale_after: 2026-12-02
sources:
  - id: document-model
    resource: /packages/query-kysely/src/relations/world.ts
    title: Logical document world and cotail_document union
  - id: search-command
    resource: /src/commands/search.ts
    title: Current search CLI surface
  - id: staged-search
    resource: /packages/query-kysely/src/operations/direct-search.ts
    title: Staged direct-search operation
  - id: root-local
    resource: /packages/query-kysely/src/operations/session-title-search.ts
    title: Root-local title fast path
  - id: after-action
    resource: /.design/pushdown/after-action0.gpt56s.md
    title: Pushdown after action
---

# Search Core Completion Draft

## What Is Up

Cotail's core product is search, and the user wants the core filled in before
opening new product areas (bookmarks, transcripts). The interesting fact this
draft starts from: **the logical document model already projects more
searchable fields than the CLI can reach.** The pushdown work just landed
(window bounding, staged qualification, root-local specialization) made new
search modes cheaper to add than they have ever been, because most candidates
inherit a physical strategy that already exists. This draft inventories the
gaps, sorts them by cost and semantics risk, and proposes a scope order.

## What Search Can Express Today

From [`search.ts`](/src/commands/search.ts):

- Four modes: `text` (user/synthetic/system/skill/assistant text),
  `reasoning`, `tool` (name/input/output/error), and `--title-only`
  (root-local fast path).
- Patterns: case-(in)sensitive regex or literal substring.
- Multi-term semantics: session-level AND — each term is an independent
  witness, satisfied by *different* documents if necessary.
- Scoping: `--since` (exact message-created), `--since-updated` +
  backfill, `--directory`, `--limit`.
- Evidence: snippets on/off.

## What The Document Model Projects But The CLI Cannot Reach

Every row of [`cotail_document`](/packages/query-kysely/src/relations/world.ts)
with its field and exposure class:

| Document field(s) | Owner | Exposure | Reachable today? |
|---|---|---|---|
| `user.text`, `synthetic.text`, `system.text`, `skill.text`, `assistant.text` | message | ordinary / system | Yes (`--type text`) |
| `assistant.reasoning` | message | reasoning | Yes (`--type reasoning`) |
| `tool.name/input/output/error` | message | tool | Yes (`--type tool`) |
| `shell.command`, `shell.output` | message | shell | **No** |
| `compaction.summary/recent/error` | message | system | **No** |
| `attachment.name/description/uri`, attachment-carried `skill.text` | message | sensitive-metadata | **No** |
| `session.title` | session | sensitive-metadata | Yes (`--title-only`) |
| `session.location` (directory, path) | session | sensitive-metadata | **No** (only exact-containment `--directory`) |

Also projected by the session relation but not documents at all: `model`,
`agent`, `slug`, `parentID` — root-local columns.

And one operation-level capability the CLI never exposes: the staged search
supports a keyset cursor
([`window.sessions.after`](/packages/query-kysely/src/operations/direct-search.ts)),
per-session child windows, and a global hit limit — the CLI offers only
`--limit`.

## Candidate Work, Sorted By Cost

### Tier 1 — field-set completion (cheap, semantics already decided)

New values for `--type`: `shell`, `compaction`, `attachment`. Each is a new
entry in `SEARCH_FIELDS`; each is message-derived, so each automatically
inherits `--since` message-created bounding through
`context.world({ messageCreatedRange })` and the staged candidate/qualify/
window pipeline. No new query machinery.

- `--type shell` answers "which sessions ran a command like X" — a genuinely
  common question this tool cannot ask today.
- `--type compaction` makes compaction summaries findable without paying for
  them in default text mode.
- `--type attachment` touches the access-policy question (below).

Also allow selecting multiple: `--type text,tool` (or repeated `--type`).
The witness machinery already accepts arbitrary field lists; the CLI
currently forces exactly one.

### Tier 2 — root-local location search (cheap, reuses the title fast path)

`--location-only` (or `--type location`): regex/literal match against
`session.directory` and `session.path` as a root-local mode, exactly the
[`session-title-search`](/packages/query-kysely/src/operations/session-title-search.ts)
shape. This is the after-action's "directory-only search may share this
root-local class" prediction, and it subsumes most uses of today's exact
`--directory` containment flag. Root-local means: no message scan, no
document union, no payload validation — the class that measured 0.47 s vs
>30 s on the live database before the fast path existed.

`--directory` should stay for exact containment; location search is for
discovery ("which machines/checkouts have sessions about X").

### Tier 3 — combinators (moderate, small semantics decisions)

- **Same-document conjunction** (`--same-document`): require one document to
  match *all* terms, instead of session-level AND. Physically *cheaper* than
  today's shape: one `EXISTS` with a conjunction instead of N independent
  `EXISTS` witnesses. Semantically it is proximity-lite — "alpha and beta
  near each other" without defining near.
- **Negation** (`--not <pattern>`): exclude sessions having any matching
  document. `NOT EXISTS` witness; the decision to make is window interaction
  — presumably negation evaluates inside the same `--since` window as
  affirmative terms, so "session has no error output *since Monday*" stays
  answerable.
- **Cursor exposure** (`--after <updatedAt:id>`): one flag wired to the
  operation's existing cursor. Makes search results properly paginable in
  scripts; today `--limit` without cursor means re-scanning page one.

### Deliberately out of scope for this wave

Relevance ranking, fuzzy matching, cross-field proximity, FTS (the sidecar
remains gated on source identity + access policy per the
[ideas map](/.design/ideas/ideas.gpt56s.md)), and per-term flag granularity
(regex-vs-literal per term). Ranking in particular would change the
deterministic `(updatedAt, sessionID)` ordering contract that every output
format and cursor depends on.

## Decisions To Make Before Implementing

1. **Exposure defaults.** `attachment.*` fields are `sensitive-metadata`
   exposure; `compaction.*` is `system`. Default text mode already exposes
   `system.text`, so exposure class has never been a CLI restriction — but
   making attachment search a first-class flag is a good moment to decide
   whether new modes are opt-in by policy or uniformly available. The
   [access-policy idea](/.design/ideas/ideas.gpt56s.md) (#8) is the durable
   home for that decision; a one-line "modes are uniform until policy exists"
   stance unblocks Tier 1.
2. **Mode orthogonality.** Keep `--type` a single field-set selector (with
   comma lists) rather than growing per-field flags (`--field tool.name=x`).
   Field-scoped search is more expressive but doubles the surface; defer
   until a concrete need survives the field-set modes.
3. **Negation window semantics** (above) — decide before implementing, since
   it silently changes what "no matches" means.

## Proposed Order

1. `--type shell` + `--type compaction` with plan/behavior tests riding the
   existing indexed fixture (both are pure field-list additions).
2. Multi-type selection (`--type text,tool`).
3. `--location-only` root-local mode.
4. `--same-document` conjunction.
5. `--not` negation + `--after` cursor.

Each step is independently shippable, none touches the ordering contract,
and all of them deepen the core before any new product area opens.

## Cross-References

- [Staged direct-search operation](/packages/query-kysely/src/operations/direct-search.ts)
  is the pipeline every Tier 1–3 change composes with.
- [Pushdown after-action](/.design/pushdown/after-action0.gpt56s.md) —
  root-local specialization (optimization B) is the physical basis for Tier 2.
- [Draft4 intent audit](/.design/pushdown/intent-audit0.glm53.md) — why
  finishing the core now outranks opening bookmarks: the trusted-profile
  and capability vocabulary debts are cheaper to pay while the command
  surface is still small.
- [README searchable-content section](/README.md) already admits "the
  current CLI does not expose a dedicated mode for every document field";
  this draft is the plan for closing that admission.
- [Development ideas](/.design/ideas/ideas.gpt56s.md) idea #8 owns the
  exposure/policy decision Tier 1 needs.
