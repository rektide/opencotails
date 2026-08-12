---
type: ImplementationReport
title: Completed owner-aware Kysely query migration
description: Records adjudication steps 8-10, authority fixtures, minimum-runtime proof, compatibility checks, and representative query plans.
resource: /query/implementation1.md
tags: [cotail, query, kysely, sqlite, implementation, authority]
status: stable
generated: { by: model:openai/gpt-5.6, at: 2026-08-11T00:00:00Z }
verified: { by: executable-tests-and-read-only-production-checks, at: 2026-08-11T00:00:00Z }
stale_after: 2026-11-11
sources:
  - id: adjudication
    resource: /query/adjudication0.md
    title: Typed query-builder adjudication
  - id: authority
    resource: /query/authority0.md
    title: Mixed V1 and V2 storage authority
  - id: prior-implementation
    resource: /query/implementation0.md
    title: Query architecture implementation and transition stop
  - id: production-database
    resource: file:///home/rektide/.local/share/opencode/opencode-local.db
    title: Read-only local opencode transition database
---

# Completed Owner-Aware Kysely Query Migration

## Outcome

Adjudication steps 8-10 are complete under the stable decision in
[`authority0.md`](/query/authority0.md). The private live store now builds one
canonical session relation: `session_v2` owns metadata, content, and counts when
its owner row exists; only a legacy session without that owner falls back to
`session`, `message`, and `part`. A completed mixed database must contain
`kv['migration.v1-v2'] = {"phase":"completed"}`. Other mixed migration states
fail at open time.

V2 content normalization includes user text and each assistant text/reasoning
array item. Evidence order uses `session_message.seq` and JSON array position;
nonzero starts and gaps are valid. V2 tool and shell requests remain explicit
errors. Legacy residue is never unioned into a V2 owner, including zero-row,
compaction omission, subtask omission, and committed-revert cases.

History now counts every row from the owner relation. Its message cutoff is
independent of session selection, and limit `0` remains unlimited. Search,
history, and lookup commands await one store operation at a time and close the
store in `finally`. The obsolete event fallback, source iteration, hand-built
`VersionSchema`, additive history reader, and old lookup reader were removed.

## Commits

| Commit | Description |
|---|---|
| `9a2f3ecc70c5` | Implement owner-aware V2 search and history |
| `dd79f43e8f93` | Finish asynchronous CLI query lifecycle |
| `f1e064a17887` | Remove obsolete direct database readers |
| `d5d7a24e` | Complete authority fixtures and compatibility docs |

These are separate jj changes. They were not amended, squashed, or pushed.

## Executable Authority Matrix

[`layout-authority.test.ts`](/packages/opencode-live-store/test/layout-authority.test.ts)
covers:

- pure V1 and pure V2 databases with the opposite tables absent;
- completed mixed exact overlap, native extension, native-only, V1-only owner,
  V1 residue, both-side unique IDs, and V2-owned zero-row projection;
- canonical V2 user text, joined input, partly/entirely synthetic omission, and
  assistant arrays containing text and reasoning;
- collapsed compaction and omitted subtask pairs whose V1-only IDs cannot leak;
- committed revert residue that remains only in legacy tables;
- nonzero sequence starts, gaps, and assistant array-position evidence;
- absent, sessions-phase, and running migration markers;
- transformed matching IDs/timestamps, cross-session ID collisions, and
  duplicate native message IDs; and
- owner-specific total/recent counts, controls, zero-message owners, separate
  cutoffs, and unlimited limit `0`.

The pre-existing characterization fixture remains byte-identical at the CLI
boundary. Its old additive-count setup was corrected to represent two canonical
legacy messages rather than one legacy plus one non-authoritative native row;
the expected human, JSONL, and TSV bytes did not change.

## Verification

Current runtime: Node `v26.6.0`, pnpm `11.20.0`.

```sh
CI=true pnpm exec tsgo -p packages/query-domain/tsconfig.json
CI=true pnpm exec tsgo -p packages/test-contracts/tsconfig.json
CI=true pnpm exec tsgo -p packages/opencode-live-store/tsconfig.json
CI=true pnpm exec tsgo -p tsconfig.json
node --test packages/opencode-live-store/test/*.test.ts
pnpm test
```

All four strict checks exited 0 without `skipLibCheck`. The live-store suite
passed 17/17 and the root domain/CLI suite passed 8/8.

Minimum Node was installed only in pnpm's isolated dlx cache; no project
dependency changed:

```sh
pnpm dlx node@22 --version
# v22.23.2
NODE_NO_WARNINGS=1 pnpm dlx node@22 --test packages/opencode-live-store/test/*.test.ts
NODE_NO_WARNINGS=1 pnpm dlx node@22 --test tests/*.test.ts
```

The Node 22 live-store suite passed 17/17 and the root suite passed 8/8. Without
`NODE_NO_WARNINGS=1`, Node 22 emits its standard experimental `node:sqlite`
warning to stderr; one characterization assertion that requires empty stderr
therefore fails even though operation output and the other seven tests pass.
Suppressing that runtime warning proves the byte assertions themselves.

Representative read-only production commands also exited 0 and returned one
valid JSONL row each:

```sh
NODE_NO_WARNINGS=1 pnpm dlx node@22 src/cli.ts search query --since 1d --limit 1 --json --db ~/.local/share/opencode/opencode-local.db
NODE_NO_WARNINGS=1 pnpm dlx node@22 src/cli.ts history --since 7d --limit 1 --json --db ~/.local/share/opencode/opencode-local.db
```

No selected message content is copied into this report. A source-boundary grep
found no Kysely, physical V2 table, or native database imports in root commands,
`query-domain`, or `test-contracts`. Kysely 0.29.5 remains a dependency only of
`opencode-live-store`.

## Query Plans

Read-only `EXPLAIN QUERY PLAN` comparisons used equivalent fixed-string
predicates on the production database. The old V1 content plan scanned session
metadata, used `part_session_idx` inside the correlated witness, and used a
temporary B-tree for ordering. The canonical plan:

- scans the two owner metadata tables through a `UNION ALL` co-routine;
- uses the `session_v2` primary-key index for owner checks;
- uses `session_message_session_type_seq_idx` for V2 user and assistant
  witnesses;
- uses SQLite's `json_each` virtual-table index only after the assistant row
  lookup;
- preserves `part_session_idx` and message primary-key lookup for V1 fallback;
  and
- retains the existing temporary ordering B-tree.

The old additive history plan ran indexed correlated counts against both message
tables for each legacy session. The canonical plan uses covering
`session_message_session_seq_idx` or `message_session_time_created_id_idx`
according to ownership. SQLite displays both `CASE` branches in the static plan,
but only the selected owner count executes. The extra metadata scan is required
to include native-only and V1-only owners; there is no whole content-table scan
or material plan regression.

## Residual Risks

- Authority depends on the audited opencode migration atomicity and
  `session_v2` ownership contract. Re-audit if that contract changes.
- Direct search still scans candidate session metadata and uses a temporary
  sort. FTS/index work remains deliberately deferred.
- V2 tool/shell canonicalization remains deliberately unsupported.
- Node 22 labels `node:sqlite` experimental and emits a warning unless runtime
  warnings are suppressed; Node 26 does not emit it.

These are documented platform/deferred-scope risks, not unmet initial-scope
acceptance conditions.

## Cross-References

- [`authority0.md`](/query/authority0.md) supplies the owner/content/count policy
  implemented here.
- [`adjudication0.md`](/query/adjudication0.md) defines the completed steps,
  output compatibility, runtime, privacy, and plan gates.
- [`implementation0.md`](/query/implementation0.md) records steps 1-7 and the
  transition stop that prompted the authority investigation.
- [`README.md`](/README.md) now describes canonical V2 content and the real
  private Kysely dependency instead of the obsolete event fallback.
