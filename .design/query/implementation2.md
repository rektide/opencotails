---
type: ImplementationReport
title: Query migration acceptance audit
description: Records post-implementation review fixes and final Node 22 and Node 26 acceptance evidence.
resource: /query/implementation2.md
tags: [cotail, query, kysely, sqlite, review, verification]
status: stable
generated: { by: model:openai/gpt-5.6, at: 2026-08-12T00:00:00Z }
verified: { by: executable-tests-and-read-only-production-checks, at: 2026-08-12T00:00:00Z }
stale_after: 2026-11-12
sources:
  - id: completed-implementation
    resource: /query/implementation1.md
    title: Completed owner-aware Kysely query migration
  - id: adjudication
    resource: /query/adjudication0.md
    title: Typed query-builder adjudication
  - id: authority
    resource: /query/authority0.md
    title: Mixed V1 and V2 storage authority
---

# Query Migration Acceptance Audit

## Outcome

An independent final review found and the parent session corrected three safety
defects before acceptance:

- partially present V1 or V2 owner layouts could be treated as an absent layout,
  bypassing mixed-migration authority checks;
- open-time schema or migration validation failures leaked the native SQLite
  descriptor; and
- the select-only adapter advertised every prepared statement as readable, so a
  write could execute through Kysely's `all()` dispatch on a writable fixture.

Capability detection now rejects incomplete owner layouts. The one compatibility
exception is an unused `session_message` table beside a complete V1 layout:
`session_message` predates `session_v2`, while `session_v2` remains the explicit
V2 ownership declaration. Store initialization closes the native handle on every
registration or validation failure. The adapter classifies read statements and
rejects ordinary writes and data-changing CTEs before execution.

The audit also removed an unused store option, restored the immutable CLI
characterization fixture, corrected its history expectation to count canonical
legacy messages, documented owner-aware lookup, and states the tested runtime
floor as Node.js 22.13 or newer.

## Verification

The final Node 26 checks passed:

```sh
CI=true pnpm exec tsgo -p tsconfig.json
node --test packages/opencode-live-store/test/*.test.ts # 21/21
pnpm test                                               # 8/8
```

The final minimum-major checks passed on Node `v22.23.2`:

```sh
NODE_NO_WARNINGS=1 pnpm dlx node@22 --test packages/opencode-live-store/test/*.test.ts # 21/21
NODE_NO_WARNINGS=1 pnpm dlx node@22 --test tests/*.test.ts                              # 8/8
```

Representative read-only commands against the live transition database returned
valid JSONL on the current runtime and Node 22:

```sh
node src/cli.ts search query --limit 1 --json --db ~/.local/share/opencode/opencode-local.db
NODE_NO_WARNINGS=1 pnpm dlx node@22 src/cli.ts history --since 7d --limit 1 --json --db ~/.local/share/opencode/opencode-local.db
```

## Remaining Scope

No initial-scope acceptance gate remains open. Deferred work is unchanged: FTS,
indexing, hydration, V2 tool/shell text semantics, and new CLI boolean syntax.

## Cross-References

- [`implementation1.md`](/query/implementation1.md) records the completed
  owner-aware migration and query-plan evidence audited here.
- [`authority0.md`](/query/authority0.md) defines why `session_v2`, rather than
  message presence, selects canonical storage.
- [`adjudication0.md`](/query/adjudication0.md) defines the acceptance gates and
  initial package boundary.
