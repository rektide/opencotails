---
type: ImplementationReport
title: Query architecture implementation and transition stop
description: Records the implemented domain/live-store workspace, passing V1 query migration, and the real-data authority evidence that stopped V2 and history migration.
resource: /query/implementation0.md
tags: [cotail, query, kysely, sqlite, implementation, stop-condition]
status: draft
generated: { by: model:openai/gpt-5.6-luna, at: 2026-08-11T00:00:00Z }
stale_after: 2026-09-11
sources:
  - id: adjudication
    resource: /query/adjudication0.md
    title: Typed query-builder adjudication
  - id: refined-kysely
    resource: /query/draft-ksyley1.md
    title: Refined Kysely query architecture
  - id: v2-storage
    resource: /v2.md
    title: opencode v2 storage research
  - id: production-database
    resource: file:///home/rektide/.local/share/opencode/opencode-local.db
    title: Read-only local opencode transition database
---

# Query Architecture Implementation And Transition Stop

## Outcome

The first seven ordered steps in [`adjudication0.md`](/query/adjudication0.md)
landed through the V1 bounded-boolean implementation. The repository is now a
pnpm workspace with exactly the initial package set:

- [`query-domain`](/packages/query-domain/src/index.ts) owns operation-shaped
  selectors, requests, results, and pure validation;
- [`opencode-live-store`](/packages/opencode-live-store/src/index.ts) owns the
  private Kysely 0.29.5 dependency, `node:sqlite` adapter, schema capabilities,
  lifecycle, selector/lookup, title search, and V1 content search; and
- [`test-contracts`](/packages/test-contracts/src/index.ts) is private and
  development-only.

The root remains the CLI composition and renderer owner. Search and lookup have
honest async operation boundaries and store-owned idempotent close. Existing CLI
title/content/get-session output remains byte-compatible under the black-box
suite. Pattern and requirement `all`/`any`/`none` execute through Kysely;
requirement `none` is correlated `NOT EXISTS`, and evidence is derived only from
the same private positive witness predicate in request order.

Implementation stopped before adjudication steps 8-10. The real transition
database does not support the proposed universal content/count authority rule,
which is an explicit stop condition rather than a test to weaken.

## Commits

| Commit | Description | Ordered step |
|---|---|---:|
| `d04d92c74d9f` | Characterize current CLI behavior | 1 |
| `01db32216f33` | Establish workspace query domain contracts | 2 |
| `348142c8fa73` | Add private Kysely node sqlite adapter | 3 |
| `3fdbdbf61cf9` | Move session resolution into live store | 4 |
| `a1c83ecefacf` | Move title search into live store | 5 |
| `8423ed456578` | Move V1 content search into live store | 6 |
| `a538d37781f7` | Complete bounded boolean content lowering | 7 |

The commits are separate jj changes and were not squashed or amended.

## Implemented Contracts

[`query-domain/search.ts`](/packages/query-domain/src/search.ts) exports
`TextPattern`, `PatternSet`, `ContentRequirement`, `ContentRequirements`,
`DirectSearchRequest`, `DirectSearchHit`, and renderer-facing `SearchResult`.
[`query-domain/session.ts`](/packages/query-domain/src/session.ts) exports
session summaries/selectors and resolution, while
[`query-domain/history.ts`](/packages/query-domain/src/history.ts) exports the
history request/result contract. Validation rejects absent or empty boolean
groups, empty/duplicate type and role lists, malformed regexes, malformed
selectors, non-finite ranges, inverted half-open ranges, and invalid limits.

Kysely and physical table declarations remain inside
[`opencode-live-store`](/packages/opencode-live-store/src/). Commands import only
the package operation interface and domain shapes. The adapter opens files with
`{ readOnly: true }`, implements `all` and `iterate`, rejects every `run`, owns
the native close path, and makes close idempotent. Operations after close fail
with `store closed`.

The V1 normalized relation in
[`layout/v1.ts`](/packages/opencode-live-store/src/layout/v1.ts) preserves current
text/reasoning/tool matching and evidence behavior. The content query in
[`query/content.ts`](/packages/opencode-live-store/src/query/content.ts) has one
session root, separate requirement witnesses, same-witness pattern groups,
correlated negative requirements, deterministic positive evidence, global
ordering, and global limit.

## Stop Evidence

The local production database was opened read-only and summarized without
copying message content into tracked artifacts. It contains 5,254 sessions;
5,251 have both `message` and `session_message` rows. Comparing per-session
counts found:

| Comparison | Equal | Unequal |
|---|---:|---:|
| legacy `message` vs all native `session_message` | 4,032 | 1,222 |
| legacy `message` vs native `user` + `assistant` | 4,859 | 395 |

Recent mismatches include sessions where V1 has 277 user/assistant rows while V2
has 274 user/assistant plus two control rows, and sessions with larger gaps.
There were no native-only sessions in this corpus, so it also cannot prove the
native-only branch. This disproves count equality and does not prove whether
missing native rows are intentionally transformed controls, partial projection,
revert behavior, or migration loss. Consequently:

- `session_message` presence is not a proven count authority discriminator;
- restricting authority to native user/assistant presence still leaves 395
  unequal transition sessions;
- content and count authority cannot be inferred from one another; and
- V2 extraction and history replacement were not implemented.

This activates the stop condition at
[`adjudication0.md`](/query/adjudication0.md#stop-and-rejection-conditions): real
transition fixtures do not yet support a reliable per-session layout or count
authority rule. Existing history addition and legacy source files remain in
place rather than being silently changed.

## Verification

Passing commands on Node `v26.6.0`, pnpm `11.20.0`:

```sh
CI=true pnpm exec tsgo -p packages/query-domain/tsconfig.json
CI=true pnpm exec tsgo -p packages/test-contracts/tsconfig.json
CI=true pnpm exec tsgo -p packages/opencode-live-store/tsconfig.json
node --test packages/opencode-live-store/test/adapter.test.ts
pnpm test
node src/cli.ts search query --limit 1 --json --db ~/.local/share/opencode/opencode-local.db
node src/cli.ts history --since 1d --limit 1 --json --db ~/.local/share/opencode/opencode-local.db
```

The three package checks exited 0. The adapter/semantic suite passed 8/8. The
root CLI/domain suite passed 8/8. The real search returned one valid JSONL hit;
the real history fixture exited 0 with no rows for that cutoff.

The exact Node 22 test was not run because no Node 22 runtime is installed; mise
lists only Node 24, 25, and 26. This remains a hard residual gate. The root-wide
strict check currently fails in retained legacy `src/opencode` files due
`node:sqlite` input/output typing; package-scoped strict checks pass without
`skipLibCheck`. Final representative `EXPLAIN QUERY PLAN` comparison was not
claimed because the migration stopped before the mixed-layout normalized CTE.

## Deferred And Unresolved

- Determine transformation semantics between V1 message roles and every V2
  message type from authoritative opencode migration/projector behavior.
- Obtain native-only, partial, control-only, duplicate, zero-message, and revert
  transition fixtures with known expected content and counts.
- Select separate, justified content and count authority rules, then resume at
  ordered step 8.
- Run all adapter/lifecycle/semantic tests on an installed minimum Node 22.x.
- Complete history migration, cleanup, root-wide strict checking, and
  representative query-plan comparison only after the authority gate passes.

FTS/index, hydration, tool/shell canonicalization, and new CLI boolean syntax
remain deferred exactly as adjudicated.

## Cross-References

- [`adjudication0.md`](/query/adjudication0.md) is authoritative for the selected
  architecture, ordered commits, acceptance tests, and this stop condition.
- [`draft-ksyley1.md`](/query/draft-ksyley1.md) explains the private adapter,
  operation boundary, and bounded boolean design implemented here.
- [`packet-query-builders0.md`](/query/packet-query-builders0.md) defines witness,
  evidence, metadata authority, and mixed-layout requirements.
- [`v2.md`](/v2.md) identifies `session_message` and `seq`, but explicitly does
  not establish transition precedence.
