---
type: EvidenceDossier
title: Bookmark guidance dredge — last 7d history and existing Markdown
description: Read-only GX audit recovering prior bookmark decisions before any implementation or Astra handoff; gate artifact for cotail-bookmarks-guidance-audit.
resource: /.design/bookmarks/dredge0.glm53.md
tags: [bookmarks, links, gate, research, audit]
status: stable
generated: { by: "model:zai-coding-plan/glm-5.3#max", at: 2026-09-07T03:00:33Z }
verified: { by: "pending parent review", at: 2026-09-07 }
stale_after: 2026-10-07
extensions:
  ticket: cotail-bookmarks-guidance-audit
sources:
  - { resource: "urn:opencode:session:ses_f86cfeb14ffev9dX8mwiS0sZIm", title: Parent thread and human decisions }
  - { resource: "urn:opencode:session:ses_f86cf0abcffeis7AGKxml4iG06", title: Cotail author session (design + implemented read slice) }
  - { resource: "urn:opencode:session:ses_f86c9d39…", title: Epilogue seam delegation (ID prefix ses_f86c9d39; full ID not captured) }
  - { resource: /.design/bookmarks/index.md, title: Current guidance index }
---

# Commission and scope

Human gate (parent session `ses_f86cfeb14ffev9dX8mwiS0sZIm`, messages
`msg_079ccf7de001zep4U7x1ga1q4r` + `msg_079cd1408001aEgZDORGVhuuPi`, 2026-09-07
02:59:28Z): *"i thought we had some md for bookmarks by now? search cotail with a
GX have it dredge up bookmark info from last 7d and here"* and *"this is gating.
use new gx"*. This dossier is that audit: read-only recovery of existing bookmark
Markdown and last-7d Cotail/OpenCode session history, with a verdict on whether
the live tickets point at the best guidance. It does not design anything new and
does not accept [implementation0](/.design/bookmarks/implementation0.gpt6a.md).

**Answer up front: yes, we had bookmark Markdown — a lot of it, and it is
current.** The worry behind the gate ("did we fail to write/retrieve the md?")
resolves to: the material exists, is less than ~7 hours old, and is already
indexed by [.design/bookmarks/index.md](/.design/bookmarks/index.md). No missed
newer agreement was found in any other session; the parent thread is the
decision genesis and the docs track it. Details, quotations, and the residual
discrepancies follow.

## Search ledger

- Profile: existing trusted `~/.config/cotail/profiles/opencode-local.json`
  (verified, not regenerated; never invoked `opencode` or any service).
  `profile_id: opencode-local`, format `cotail.source-profile/v1`, generated
  2026-09-02T07:06:14Z, `source.path:
  /home/rektide/.local/share/opencode/opencode-local.db`. Both
  `~/.local/share/opencode/opencode.db` (5 MB, stale) and `opencode-local.db`
  (21.7 GB, live channel DB with active `-wal`) exist; the profile points at the
  **live channel DB**, matching the human's "actual OpenCode source/channel DB"
  intent. Read-only `query_only` connections throughout.
- `cotail search bookmark --since 7d --no-snippet --limit 50` — primary
  Message-created cutoff sweep (exact `--since` semantics: only Messages created
  at/after cutoff match). ~30 sessions, triaged below.
- `cotail search memento|epilogue|session-links --since 7d --no-snippet` —
  discriminating supplements, all hit sets subsets of the bookmark set plus
  incidental matches.
- `cotail search 'mark(ed)? summary' --since 7d` and `cotail search bookmark
  rektide_ --since 7d` — **timed out** (2×120 s). Consistent with open P1 bug
  [cotail-search-oom](#gaps) (JS payload validator ~7×/message on the 21.7 GB
  DB). Retried nothing heavier; no results lost that the fixed-string and
  directory-filtered passes did not cover.
- `cotail history --since 12h --directory /home/rektide/src/cotail` — confirmed
  exactly one session active in the Cotail directory (the author session).
- Bounded SQLite reads (`node:sqlite`, `readOnly` + `PRAGMA query_only`),
  scratch `.test-agent/bookmark-dredge/read.ts`: per-session `session_message`
  pulls (`type='user'` enumeration, final-report extraction). No writes to the
  source DB. Session payload projection is flat `{time, text}`; the CLI has no
  transcript-view command, which is why this fallback was used.
- Filesystem: `.design/bookmarks/` full listing + mtimes; rekon
  `design/session-mementos/`; opensesser `design/bookmark-links/`;
  `~/archive/doc/opencode/patches.md` entry 22; `bd show/list` read-only in
  Cotail and Rekon.
- Limits: review sessions' sub-400-word GX reports were not extracted verbatim
  (their outcomes are recorded in the `cotail-tools-read` ticket notes and
  callable-read0 addendum, which were read instead); assistant messages inside
  the author session after 02:24Z are tool-call bodies with ≤75-char texts, so
  the durable record for that phase is the jj commits + tickets + receipts. All
  timestamps below are UTC from the session DB.

## Strongest existing documents

1. [links-tools0.gpt6a.md](/.design/bookmarks/links-tools0.gpt6a.md) — the
   k=v link contract: bookmark target = source endpoint; Target-valued metadata
   = definitive link; descriptive JSON never becomes identity;
   `rektide_cotail_bookmark_kv` indexed by canonical endpoint. **Unaccepted
   design**, gated by parent. Its Node-helper section is superseded (below).
2. [summary0.gpt6a.md](/.design/bookmarks/summary0.gpt6a.md) — storage pivot
   (`rektide_*` records/tables in the selected OpenCode channel DB, explicit
   alternate store), the five source/channel concepts, minimal source-catalog
   discipline, shared mark contract, "next visible response" proposal.
   **Unaccepted except the human-settled storage default.**
3. [runtime-probe0.gpt6a.md](/.design/bookmarks/runtime-probe0.gpt6a.md) —
   verified evidence (12/12, Node 26.6.0 + Bun 1.4.1) that the direct
   in-process Promise/JSON seam works across installed Effect versions;
   supersedes the helper-process recommendation.
4. [callable-read0.gpt6a.md](/.design/bookmarks/callable-read0.gpt6a.md) —
   receipt of the first **implemented and reviewed** slice: shared `sessionGet`
   operation, public `cotail_session_get` tool + `CotailRead.sessionGet` RPC,
   with parent+GX acceptance addendum (2026-09-07 02:58Z). Private/unpublished,
   not installed live.
5. [implementation0.gpt6a.md](/.design/bookmarks/implementation0.gpt6a.md) —
   parent's pre-audit reading order + first-checkpoint brief. Audited below:
   accurate against recovered evidence, correctly demoted to candidate.
6. Older foundation: [draft5.gpt56.md](/.design/bookmarks/draft5.gpt56.md)
   (Target/capture/resolution concepts; XDG-only storage superseded), draft0–4
   (Aug 4–21 lineage, superseded), [applications.glm52.md](/.design/bookmarks/applications.glm52.md)
   (idea inventory). Cross-project: rekon
   `design/session-mementos/{brief0,checkpoint0,marking0,references0}.gpt6a.md`,
   opensesser `design/bookmark-links/consumer0.gpt6a.md`, patches.md entry 22.

## Key sessions and quotations

- `ses_f86cfeb14ffev9dX8mwiS0sZIm` (kind-planet, opencode-term-v2, 09-07
  00:06→03:01) — parent thread; 8 human messages, all enumerated. See decision
  map.
- `ses_f86cf0abcffeis7AGKxml4iG06` (happy-nebula, cotail, 09-07
  00:07→02:47) — the Astra Cotail author; 7 steering messages; produced
  summary0, links-tools0, runtime-probe0, callable-read0, the P1 ticket
  revision, and the implemented read slice (jj `37f81b27`, `8f31eb4b`,
  `a8a74271`, docs `d7f851b1`).
- `ses_f86c9d39…` (quiet-squid, 09-07 00:13→00:44) — epilogue seam; carried the
  human's display refinements (below) and the authorized selector slice.
- `ses_f86b232bdffeq2RNCEfxTn3X8S` (glowing-pixel, 00:38→00:47) — verified
  memento docs/tickets: 7 files, 74 local references, 0 failures; source-receipt
  correction `13e2e688`.
- `ses_f8672cc8…` (playful-river, 01:48) — verified cross-project refs incl.
  patches.md entry 22 refinement.
- `ses_f863790e…` / `ses_f86378fd…` (quick-harbor / misty-river, 02:52→02:57) —
  the two GX reviews of the fixed diff `0e507467..a8a74271`; outcomes recorded
  verbatim in the ticket: *Standards: 0 hard breaches, no actionable code
  repair; Spec: 0 blocking findings* (stale-description guidance applied
  02:58Z in jj `uxvpyxntyqks`).
- Ruled out as bookmark-related despite search hits: `ses_f96bca35` ("bookmark &
  push" = jj branches), `ses_f872bf58` (rekon praxis review; zero
  bookmark/memento/marking content), `ses_fa1b67cc` (Sep 1–2 epic genesis from
  jj history — older foundation for the ticket tree, not bookmark decisions).
  Tangled "timeline bookmarks" hits are a different product domain.

## Chronological decision map (UTC, 2026-09-07 unless noted)

1. **00:06** — human genesis (`msg_0793014f1…`): multi-session last-Q/response
   display; "dump the last summary, as bookmarked by ~/src/cotail"; *"we should
   store our bookmarks in any given db, defaulting to rektide_\* records in the
   opencode channel database"*; spawn an Astra in cotail to start the design;
   marking tool default-next-response, explicit historical + child targets.
2. **00:07** — Astra author session spawned with those directions.
3. **00:17** — rekon `rekon-session-mementos` anchor created (`bfabb06c`);
   display clarified as current window/client, ordered filters then lookers;
   recent-everywhere not default.
4. **00:32** — human refinements via parent (seq 428 of quiet-squid): Current +
   visible tabs; sequential narrowing; visited-this-process gets **its own
   ticket** (distinct visit record); early termination with per-filter
   authority; modular lookers. Selector slice authorized.
5. **00:38–00:47** — verification pass; storage pivot recorded in summary0 and
   the bookmark tickets (supersedes draft5 XDG-only and the old cotail-owned
   local-SQLite assumption).
6. **01:28** — human: symlink-like session links desire → patches.md entry 22;
   `~/src/opencode-lastact/` noted.
7. **01:35** — human: *"k=v bookmarks … definitive links. we could browse that
   in ~/src/opensesser … cotail being a tool sooner rather than later, pre-req."*
   → links-tools0, `cotail-tools` epic + P1 children (01:53),
   `rekon-session-mementos-links`, `opensess-bookmark-links`.
8. **01:38–01:43** — parent's Opensesser consumer facts (root-only list excludes
   children → shared typed RPC, not tool-as-UI); beads cross-refs as
   constitution-namespace incarnation; bd 1.0.3 `external:<project>:<capability>`
   correction ("no configured bridge", not "impossible").
9. **01:56→02:07** — runtime probe authorized and executed (12/12); helper
   recommendation revised to direct in-process seam.
10. **02:11** — parent checkpoint: `cotail-tools-read` authorized, fixture-only.
11. **02:24–02:47** — read slice implemented; **02:50–02:58** — human asks for GX
    read-only review; two GX reviews run; docs-only correction accepted;
    ticket/receipt updated. Next gate named: **consumer source/server binding**.
12. **02:59** — human imposes this audit gate; parent saves implementation0 as
    pre-audit candidate (`qltmknsywvxm`), opens the gate ticket
    `cotail-bookmarks-guidance-audit` (`pnxnqwtrtzlx`), spawns this GX
    (`ses_f86308e82ffeWe0qHb6pgb1IVp`).

## Contradictory or superseded claims

- **Node helper (links-tools0 §§"Recommended smallest host") — SUPERSEDED** by
  runtime-probe0/callable-read0 and the `cotail-tools` epic notes.
  implementation0 already warns against reintroducing it. Anyone reading only
  links-tools0 gets stale transport guidance.
- **draft5 XDG-only storage — SUPERSEDED** by the human's rektide_*-in-channel-DB
  pivot (summary0; epic/store/source-catalog tickets explicitly record the
  supersession).
- **`cotail-tools-read` stale DESCRIPTION** ("still awaiting parent
  authorization") — corrected 02:58Z; old text preserved verbatim in ticket
  notes. Old checkouts still show the stale form.
- **Naming refinement, never explicitly human-accepted**: human said
  `rektide_*`; docs/tickets propose owned `rektide_cotail_*` objects and a
  `rektide_cotail_bookmark_kv` table. Reasonable, but the parent should confirm
  the prefix at the first checkpoint rather than treat it as a human decision.
- **Deployment honesty**: "implemented and fixture-verified" ≠ installed. README,
  receipts, and tickets consistently keep the plugin private/unpublished; no
  claim found that breaks this.
- **Writer concurrency unproven**: runtime-probe0 and the ticket explicitly
  disclaim co-located-write success; implementation0 correctly requires a
  demonstrated conflict check before in-host writes. No contradiction, but a
  live boundary.

## Gaps

- No bookmark storage schema, writer, or k=v codec exists yet — by design
  (gated, and `cotail-tools-exact-write` is blocked on
  store/resolver/metadata-links).
- Mark-intent / "next visible response" semantics (summary0 §§) remain proposals;
  `cotail-bookmarks-mark-intent` is deferred and depends on Rekon producer work.
- **Beads graph drift**: implementation0 says the guidance audit is "blocking the
  source-catalog prerequisite", but `cotail-bookmarks-guidance-audit` currently
  has **no dependency edges** (only its epic parent). Parent owns adding/closing
  edges; flagged, not changed.
- `cotail-search-oom` (P1, open; human called it "the high-priority next fix" on
  2026-09-04) still bites — this audit hit it twice. It competes with bookmarks
  for next attention and degrades every future history dredge like this one.
- Opensesser consumer source/server binding (the named next gate after this
  audit) has no ticket yet in Cotail; `cotail-tools-read` stays open for it.
- Review sessions' verbatim reports exist only in-session; their outcomes are
  otherwise recorded in the ticket + receipt (adequate, noted for provenance).

## Recommended reading order

For the parent reviewing this gate, in efficiency order:
1. This dossier's decision map + contradictions.
2. [implementation0](/.design/bookmarks/implementation0.gpt6a.md) — still the
   best single reading-order brief; verified accurate against everything
   recovered here.
3. [callable-read0](/.design/bookmarks/callable-read0.gpt6a.md) incl. review
   addendum, then [links-tools0](/.design/bookmarks/links-tools0.gpt6a.md) k=v
   contract, then [summary0](/.design/bookmarks/summary0.gpt6a.md) storage +
   source identity.
4. patches.md [entry 22](file:///home/rektide/archive/doc/opencode/patches.md#session-links)
   (steer/move/link "Keep distinct" semantics) and rekon
   [references0](file:///home/rektide/src/rekon/design/session-mementos/references0.gpt6a.md)
   for the namespace/brefs direction.
5. Older foundation only as needed: draft5 (concepts), index lineage notes.

## Verdict

**The live ticket set points at the best available guidance.** After the 02:58Z
correction round, every checked ticket (`cotail-bookmarks` epic, store,
source-catalog, metadata-links, mark-intent, summary-lookup, tools epic,
tools-read, tools-exact-write) carries the current human direction
(rektide_*-in-selected-channel-DB, k=v exact-Target links, tool-first
prerequisite, deferred next-response binding) and cites the right docs.
implementation0's reading order and supersession warnings match the recovered
evidence trail exactly; nothing in any session contradicts it, and no newer or
better bookmark agreement exists outside the parent thread's own decisions.
Residual items for the parent before releasing the gate: (a) confirm or adjust
the `rektide_cotail_*` prefix as a human decision; (b) add the missing Beads
edge(s) for this audit ticket or drop that claim; (c) decide relative priority
of `cotail-search-oom` vs the bookmark path; (d) name the consumer
source-binding gate's owner/ticket. This dossier asserts nothing about
implementation approval — **gate is ready for parent review; not an
implementation release.**

## Cross-references

- [Bookmark design index](/.design/bookmarks/index.md) — nav hub this dossier
  now sits beside (index untouched during this audit, per instructions).
- [Ticket `cotail-bookmarks-guidance-audit`](.beads/issues.jsonl) — gate owner.
- [Callable read receipt](/.design/bookmarks/callable-read0.gpt6a.md) —
  implemented slice this audit confirms as reviewed/accepted, not live.
- [Rekon session-mementos](file:///home/rektide/src/rekon/design/session-mementos/README.md)
  and [Opensesser consumer](file:///home/rektide/src/opensesser/design/bookmark-links/consumer0.gpt6a.md)
  — cross-project anchors verified current.
- Scratch reader used for bounded history reads:
  [.test-agent/bookmark-dredge/read.ts](/.test-agent/bookmark-dredge/read.ts)
  (ignored directory; README included).
