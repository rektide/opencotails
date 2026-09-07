---
type: EvidenceDossier
title: Bookmark guidance dredge — last 7d history and existing Markdown
description: Read-only GX audit recovering prior bookmark decisions before any implementation or Astra handoff; gate artifact for cotail-bookmarks-guidance-audit. Revision 2 applies parent review corrections.
resource: /.design/bookmarks/dredge0.glm53.md
tags: [bookmarks, links, gate, research, audit]
status: draft
generated: { by: "model:zai-coding-plan/glm-5.3#max", at: 2026-09-07T03:00:33Z }
revised: { by: "model:zai-coding-plan/glm-5.3#max", at: 2026-09-07, from: 4869da51 }
stale_after: 2026-10-07
extensions:
  ticket: cotail-bookmarks-guidance-audit
sources:
  - { resource: "urn:opencode:session:ses_f86cfeb14ffev9dX8mwiS0sZIm", title: Parent thread and human decisions }
  - { resource: "urn:opencode:session:ses_f86cf0abcffeis7AGKxml4iG06", title: Cotail author session (design + implemented read slice) }
  - { resource: "urn:opencode:session:ses_f86c9d395ffeSQu7asYuV7a2aC", title: Epilogue seam delegation }
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

**Answer up front: yes, bookmark Markdown existed and is current.** The index
plus eight docs under [.design/bookmarks](/.design/bookmarks/index.md) cover the
whole arc, with the current-era set authored/committed during this thread's
window and older drafts preserved as lineage. In the bounded searches completed
below, no bookmark decision surfaced outside the parent thread's own trail and
the docs/tickets that track it; coverage limits (two timed-out sweeps, two
capped sweeps, channels not searched) are stated rather than papered over.

## Revision note (v2)

Parent read all 268 lines of revision 1 (preserved at jj `4869da51`) and
verified live Dolt. This revision applies those corrections and adds nothing
architectural: (1) the claimed missing audit→source-catalog edge was an
observed-time snapshot, not present drift — live Dolt shows
`cotail-bookmarks-guidance-audit` **BLOCKS** `cotail-bookmarks-source-catalog`;
(2) `cotail-tools-read` is **CLOSED** (parent `b16d7342`; GX doc correction
`3f638d8c`), with consumer source/server binding explicitly outside the
completed slice — it gates consumer routing, not bare library bookmark storage,
and is not "the next gate after audit"; (3) the two 120 s timeouts are recorded
as observed timeouts only, not a reproduced heap-OOM of `cotail-search-oom`;
(4) negative-search claims narrowed to completed searches with counts/caps;
(5) doc dating now uses jj authored history, and the second database file is no
longer called stale from size alone; (6) session/message references carry exact
IDs where retained; (7) the search ledger lists exact invocations; (8) the
`rektide_cotail_*` prefix is an implementation proposal for the first schema
checkpoint, not an additional human gate; (9) trust metadata corrected. One
supplemental bounded search (`symlink`) was run read-only during this revision.

## Search ledger

Profile: existing trusted `~/.config/cotail/profiles/opencode-local.json`
(verified, not regenerated; no `opencode` executable or service was invoked).
`profile_id: opencode-local`, format `cotail.source-profile/v1`, generated
2026-09-02T07:06:14Z, `source.path:
/home/rektide/.local/share/opencode/opencode-local.db`. A second, much smaller
database file (`opencode.db`, ~5 MB) exists beside the profile-selected
`opencode-local.db` (21.7 GB, live channel DB with active `-wal`); it was not
inspected and nothing here depends on it. All DB access was read-only
(`readOnly` + `PRAGMA query_only`).

Exact invocations (default regex semantics unless `-F`; multi-pattern = required
Session-level AND; `--since` = exact Message-created cutoff):

| Command (run from /home/rektide/src/cotail) | Result |
|---|---|
| `cotail search bookmark --since 7d --no-snippet --limit 50` \| `head -60` | 30 sessions shown; display truncated by `head -60`, footer count not captured; limit 50 |
| `cotail search memento --since 7d --no-snippet --limit 15` | 8 sessions |
| `cotail search epilogue --since 7d --no-snippet --limit 15` | **15 sessions — at limit cap** |
| `cotail search 'session-links' --since 7d --no-snippet --limit 10` | 4 sessions |
| `cotail search bookmark 'key.?value' --since 7d --no-snippet --limit 10` | 5 sessions (two patterns, AND) |
| `cotail search cotail rekon --since 7d --no-snippet --limit 25` \| `head -35` | 18 sessions shown; footer not captured |
| `cotail search bookmark --since 7d -F --directory /home/rektide/src/cotail --limit 3` | 1 session |
| `cotail history --since 12h --directory /home/rektide/src/cotail --limit 15` | 1 session |
| `cotail search symlink -F --since 7d --no-snippet --limit 20` (v2 supplement) | **20 sessions — at limit cap**; shown entries incidental (dotfiles/tooling) |

Timed out at 120 s (observed timeouts; not completed, cause not isolated):
`cotail search 'mark(ed)? summary' --since 7d --no-snippet --limit 10` (single
regex pattern containing a literal space) and `cotail search bookmark rektide_
--since 7d --no-snippet --limit 10` (two default-regex patterns, AND). Both are
consistent with, but do not reproduce or isolate, the known open P1 bug
[cotail-search-oom](#gaps); broad regex sweeps over the 21.7 GB live DB remain
impractical for future dredges. Not retried, per instruction.

Bounded SQLite reads (scratch `.test-agent/bookmark-dredge/read.ts`,
`node:sqlite` read-only): per-session `session_message` pulls — parent-thread
user messages, author-session steering, spawn prompts, final-report probes. The
CLI has no transcript-view command, which is why this fallback was used.

Coverage limits: `--type` stayed default `text` (no reasoning/tool-mode
content search); no title-only pass; two sweeps at their result caps
(`epilogue`, `symlink`) may hide additional incidental matches; the two timed-out
sweeps were never completed; sessions whose bookmark discussion avoids every
searched term would only surface via the message pulls actually performed. No
claim is made about channels not searched.

## Strongest existing documents

Current era (jj first/last-touch 2026-09-06 20:20–23:03 local, i.e. authored
during this thread; commit evidence in jj history):

1. [links-tools0.gpt6a.md](/.design/bookmarks/links-tools0.gpt6a.md) — the
   k=v link contract: bookmark target = source endpoint; Target-valued metadata
   = definitive link; descriptive JSON never becomes identity;
   `rektide_cotail_bookmark_kv` indexed by canonical endpoint. **Unaccepted
   design**, gated by parent. Its Node-helper section is superseded (below).
2. [summary0.gpt6a.md](/.design/bookmarks/summary0.gpt6a.md) — storage pivot
   (`rektide_*` records/tables in the selected OpenCode channel DB, explicit
   alternate store), five source/channel concepts, minimal source-catalog
   discipline, shared mark contract, "next visible response" proposal.
   **Unaccepted except the human-settled storage default.**
3. [runtime-probe0.gpt6a.md](/.design/bookmarks/runtime-probe0.gpt6a.md) —
   verified evidence (12/12, Node 26.6.0 + Bun 1.4.1) for the direct in-process
   Promise/JSON seam across installed Effect versions; supersedes the
   helper-process recommendation.
4. [callable-read0.gpt6a.md](/.design/bookmarks/callable-read0.gpt6a.md) —
   receipt of the first implemented slice: shared `sessionGet` operation, public
   `cotail_session_get` tool + `CotailRead.sessionGet` RPC, parent+GX acceptance
   addendum. Private/unpublished, not installed live; ticket now CLOSED (see
   contradictions).
5. [implementation0.gpt6a.md](/.design/bookmarks/implementation0.gpt6a.md) —
   parent's pre-audit reading order + first-checkpoint brief, committed
   23:03 local just before this audit; demoted to candidate by its own gate
   text. Audited below: accurate against recovered evidence.
6. [draft5.gpt56.md](/.design/bookmarks/draft5.gpt56.md) — committed 20:20
   local at the start of the author session; foundational replacement design
   whose Target/capture/resolution concepts survive while its XDG-only storage
   restriction is superseded.

Older foundation (jj: one wave commit 2026-08-16 06:11 for draft0–3 +
applications; draft4 2026-08-21 00:52): superseded lineage recorded in the
[index](/.design/bookmarks/index.md). Cross-project anchors (rekon
`design/session-mementos/{brief0,checkpoint0,marking0,references0}.gpt6a.md`,
opensesser `design/bookmark-links/consumer0.gpt6a.md`, patches.md entry 22) are
current-era and verified by their own sessions.

## Key sessions, with retained message identities

- `ses_f86cfeb14ffev9dX8mwiS0sZIm` (kind-planet, opencode-term-v2, 09-07
  00:06→03:01Z) — parent thread; 8 human messages, all read in full during this
  audit (abridged quotes below; full text retained in the source DB):

  | seq | message id | UTC | gist |
  |---|---|---|---|
  | 6 | `msg_0793014f1001QWZtAlb9MN8s3l` | 00:06:29 | genesis: multi-session Q/response, bookmarked summary, `rektide_*` in channel DB, marking tool defaults |
  | 971 | `msg_0797ace74001F5iBKj3phjYNQO` | 01:28:06 | session symlinks desire → patches.md; opencode-lastact |
  | 1150 | `msg_07981b37c001kQa8a9DWyZYD9F` | 01:35:38 | k=v definitive links; opensesser; cotail-as-tool pre-req |
  | 1291 | `msg_079861b1c001rEI70RDAr79cdK` | 01:40:52 | beads cross-refs + constitution namespace |
  | 1797 | `msg_079c5c988001NP7SHFV8IZ9PQw` | 02:50:07 | bookmarks next major tool win; GX read-only review |
  | 1834 | `msg_079c5f1b70017lIPTUVtLbM68T` | 02:50:45 | no Astra/general unless told |
  | 1992 | `msg_079ccf7de001zep4U7x1ga1q4r` | 02:59:28 | this gate: dredge last 7d |
  | 1993 | `msg_079cd1408001aEgZDORGVhuuPi` | 02:59:28 | "this is gating. use new gx" |

- `ses_f86cf0abcffeis7AGKxml4iG06` (happy-nebula, cotail, 09-07
  00:07→02:47Z) — Astra Cotail author; 7 steering messages read
  (`msg_07930f55f001qI5JDuQP8JYVVp` 00:07 spawn;
  `msg_07938aa12001rgHdk94wytBjNV` 00:17 rekon anchor + display scope;
  `msg_0798337f60017C0A1DV0lHHRl5` 01:37 k=v links direction;
  `msg_07984568a001YFARU0EYyzT7xy` 01:38 opensesser consumer facts/RPC;
  `msg_07988fd34001f2286fYnjCGJcR` 01:43 namespace/bd correction;
  `msg_07995038c001O3CvfhJ9sTweXQ` 01:56 probe authorization;
  `msg_079a2d09b001wju8GDfFu2p4ce` 02:11 implementation authorization).
  Produced summary0, links-tools0, runtime-probe0, callable-read0, the P1
  ticket revision, and the implemented read slice (jj `37f81b27`, `8f31eb4b`,
  `a8a74271`, docs `d7f851b1`).
- `ses_f86c9d395ffeSQu7asYuV7a2aC` (quiet-squid, 00:13→00:44Z) — epilogue
  seam; human display refinements arrived via
  `msg_079479e5d001Oyc1zU0RbuiVie` (00:32): Current + visible tabs, sequential
  narrowing, visited-this-process as its own ticket, early termination with
  per-filter authority, modular lookers; selector slice authorized.
- `ses_f86b232bdffeq2RNCEfxTn3X8S` (glowing-pixel, 00:38→00:47Z) — verified
  memento docs/tickets: 7 files, 74 local references, 0 failures; source-receipt
  correction `13e2e688`.
- `ses_f8672cc8bffedZFFN7Sr8gIiun` (playful-river, 01:48Z) — verified
  cross-project refs incl. patches.md entry 22 refinement.
- `ses_f863790e1ffeyIbC0xlpJ0rOI6` / `ses_f86378fd5ffeBx60c2JBSZ5lAl`
  (quick-harbor / misty-river, 02:52→02:57Z) — the two GX reviews of fixed diff
  `0e507467..a8a74271`; outcomes recorded verbatim in the (now-closed)
  `cotail-tools-read` ticket: *Standards: 0 hard breaches, no actionable code
  repair; Spec: 0 blocking findings*. Their sub-400-word report bodies were not
  extracted verbatim in this audit; the follow-up steering message in the
  spec/fix session (seq 69, 02:5xZ) was read but its message ID was not
  captured.
- Ruled out as bookmark-related despite search hits: `ses_f96bca35` ("bookmark
  & push" = jj branches), `ses_f872bf58` (rekon praxis review; zero
  bookmark/memento/marking content found in its user messages), `ses_fa1b67cc`
  (Sep 1–2 epic genesis from jj history — older foundation for the ticket tree).
  Tangled "timeline bookmarks" and the v2 `symlink` supplement hits are other
  domains (browser bookmarks; filesystem symlinks in unrelated projects).

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
4. **00:32** — human refinements (`msg_079479e5d…` via quiet-squid): Current +
   visible tabs; sequential narrowing; visited-this-process gets **its own
   ticket** (distinct visit record); early termination with per-filter
   authority; modular lookers. Selector slice authorized.
5. **00:38–00:47** — verification pass; storage pivot recorded in summary0 and
   the bookmark tickets (supersedes draft5 XDG-only and the old cotail-owned
   local-SQLite assumption).
6. **01:28** — human: symlink-like session links desire → patches.md entry 22;
   `~/src/opencode-lastact/` noted.
7. **01:35** — human (`msg_07981b37c…`): *"k=v bookmarks … definitive links. we
   could browse that in ~/src/opensesser … cotail being a tool sooner rather
   than later, pre-req."* → links-tools0, `cotail-tools` epic + P1 children
   (01:53), `rekon-session-mementos-links`, `opensess-bookmark-links`.
8. **01:38–01:43** — parent's Opensesser consumer facts (root-only list excludes
   children → shared typed RPC, not tool-as-UI); beads cross-refs as
   constitution-namespace incarnation; bd 1.0.3 `external:<project>:<capability>`
   correction ("no configured bridge", not "impossible").
9. **01:56→02:07** — runtime probe authorized and executed (12/12); helper
   recommendation revised to direct in-process seam.
10. **02:11** — parent checkpoint: `cotail-tools-read` authorized, fixture-only.
11. **02:24–02:47** — read slice implemented; **02:50–02:58** — human asks for GX
    read-only review; two GX reviews run; docs-only correction accepted
    (`3f638d8c` per the close record); ticket/receipt updated.
12. **02:59** — human imposes this audit gate; parent saves implementation0 as
    pre-audit candidate (`qltmknsywvxm`), opens the gate ticket
    `cotail-bookmarks-guidance-audit` (`pnxnqwtrtzlx`), spawns this GX
    (`ses_f86308e82ffeWe0qHb6pgb1IVp`).
13. **Post-v1 (observed during this revision)** — parent closed
    `cotail-tools-read` in `b16d7342` with read-scope tested acceptance
    ("consumer source/server binding and deployment are outside this completed
    read slice"); live Dolt shows the gate ticket **BLOCKS**
    `cotail-bookmarks-source-catalog`. Gate remains closed.

## Contradictory or superseded claims

- **Node helper (links-tools0 §§"Recommended smallest host") — SUPERSEDED** by
  runtime-probe0/callable-read0 and the `cotail-tools` epic notes.
  implementation0 already warns against reintroducing it.
- **draft5 XDG-only storage — SUPERSEDED** by the human's
  rektide_*-in-channel-DB pivot (summary0; epic/store/source-catalog tickets
  explicitly record the supersession).
- **`cotail-tools-read` ticket wording vs status**: Description/Design retain
  some historical pending/open phrasing, but the ticket is CLOSED and the close
  reason is authoritative. This is residual doc drift, not an operational
  blocker; older checkouts additionally show the pre-`3f638d8c` stale form.
- **Naming proposal, not mandate**: human selected the `rektide_*` namespace;
  `rektide_cotail_*` objects and the `rektide_cotail_bookmark_kv` table are a
  reasonable implementation proposal to confirm at the first schema checkpoint
  (kept as that checkpoint item below), not an additional human gate.
- **Deployment honesty**: "implemented and fixture-verified" ≠ installed. README,
  receipts, and tickets consistently keep the plugin private/unpublished; no
  claim found that breaks this.
- **Writer concurrency unproven**: runtime-probe0 and the tickets explicitly
  disclaim co-located-write success; implementation0 correctly requires a
  demonstrated conflict check before in-host writes. No contradiction, but a
  live boundary.

## Gaps

- No bookmark storage schema, writer, or k=v codec exists yet — by design
  (gated; `cotail-tools-exact-write` is blocked on
  store/resolver/metadata-links, and the audit gate blocks
  `cotail-bookmarks-source-catalog` in live Dolt).
- Mark-intent / "next visible response" semantics (summary0 §§) remain proposals;
  `cotail-bookmarks-mark-intent` is deferred pending Rekon producer work.
- **Observed-time note**: at ~2026-09-07 03:1xZ this auditor's `bd show
  cotail-bookmarks-guidance-audit` printed no dependency section; the parent's
  live-Dolt check and this revision's recheck both show the audit **BLOCKS**
  `cotail-bookmarks-source-catalog` (`bd dep list` concurs). Recorded as a
  snapshot discrepancy in observation timing, not present drift; no edge was
  added by this audit.
- `cotail-search-oom` is a known, older, user-confirmed P1 failure (2026-09-04
  note). This audit **observed** two 120 s CLI timeouts on broad regex/AND
  sweeps but did not reproduce its fatal signature or isolate its cause; the
  attribution is consistency, not confirmation. It stays relevant as a
  practical limit on future broad history dredges; the user's latest explicit
  direction (2026-09-07) is bookmarks as the next major tool win, and no
  priority change is made here.
- Consumer source/server binding (outside the closed read slice) gates safe
  consumer routing, not bare library bookmark storage; the parent owns any
  separate follow-up. No Cotail ticket records it yet.
- Review sessions' verbatim reports exist only in-session; their outcomes are
  recorded in the closed ticket + receipt (adequate, noted for provenance).

## Recommended reading order

For the parent reviewing this gate, in efficiency order:
1. This dossier's decision map + contradictions/revision note.
2. [implementation0](/.design/bookmarks/implementation0.gpt6a.md) — still the
   best single reading-order brief; consistent with everything recovered here,
   with its own gate text keeping it non-authoritative.
3. [callable-read0](/.design/bookmarks/callable-read0.gpt6a.md) incl. review
   addendum, then [links-tools0](/.design/bookmarks/links-tools0.gpt6a.md) k=v
   contract, then [summary0](/.design/bookmarks/summary0.gpt6a.md) storage +
   source identity.
4. patches.md [entry 22](file:///home/rektide/archive/doc/opencode/patches.md#session-links)
   (steer/move/link "Keep distinct" semantics) and rekon
   [references0](file:///home/rektide/src/rekon/design/session-mementos/references0.gpt6a.md)
   for the namespace/brefs direction.
5. Older foundation only as needed: draft5 (concepts), draft0–4/applications
   (Aug lineage), index notes.

## Verdict

Within the searches this audit completed, the live ticket set points at the best
available guidance: every checked ticket (`cotail-bookmarks` epic, store,
source-catalog, metadata-links, mark-intent, summary-lookup, tools epic,
tools-exact-write, and the closed tools-read) carries the current human
direction (rektide_*-in-selected-channel-DB, k=v exact-Target links,
tool-first prerequisite, deferred next-response binding) and cites the right
docs; the Beads graph now reflects the audit gate blocking source-catalog.
implementation0's reading order and supersession warnings are consistent with
the recovered trail, and no additional bookmark decision was found in any
completed bounded search beyond the parent thread's own choices. Items the
parent may still want to settle when releasing the gate: the first schema
checkpoint naturally confirms the `rektide_cotail_*` prefix as an
implementation choice; stale-but-closed ticket wording is doc drift only;
`cotail-search-oom` remains an independent open P1 that limits broad dredges;
consumer-binding follow-up is parent-owned and separate. Coverage limits above
bound this verdict — it is not a claim about unsearched channels. **Gate ready
for parent review; not an implementation release.**

## Cross-references

- [Bookmark design index](/.design/bookmarks/index.md) — nav hub this dossier
  sits beside (index untouched during this audit).
- Ticket `cotail-bookmarks-guidance-audit` — gate owner; records live in
  [/.beads/issues.jsonl](/.beads/issues.jsonl) (export) and the Dolt source of
  truth.
- [Callable read receipt](/.design/bookmarks/callable-read0.gpt6a.md) —
  implemented, reviewed, closed slice; not installed live.
- [Rekon session-mementos](file:///home/rektide/src/rekon/design/session-mementos/README.md)
  and [Opensesser consumer](file:///home/rektide/src/opensesser/design/bookmark-links/consumer0.gpt6a.md)
  — cross-project anchors verified current.
- Scratch reader used for bounded history reads:
  [.test-agent/bookmark-dredge/read.ts](/.test-agent/bookmark-dredge/read.ts)
  (ignored directory; README included).
- Predecessor: revision 1 at jj `4869da51` (superseded by this file's
  corrections; preserved for review trail).
