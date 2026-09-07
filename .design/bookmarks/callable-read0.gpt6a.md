---
type: ImplementationReport
title: First callable Cotail Session read
description: Implemented shared bounded async Session read plus public OpenCode tool/RPC, with isolated host error and cancellation evidence.
resource: /.design/bookmarks/callable-read0.gpt6a.md
tags: [cotail, tools, rpc, session, read-only, implementation]
status: draft
generated: { by: "model:openai/gpt-6-astra#xhigh", at: 2026-09-07T02:42:37Z }
stale_after: 2026-10-07
sources:
  - { resource: /.design/bookmarks/runtime-probe0.gpt6a.md, title: Accepted in-process boundary evidence }
  - { resource: /src/tools/session-get/index.ts, title: Shared async operation boundary }
  - { resource: /packages/opencode-plugin/src/index.ts, title: Public Effect-facing tool and RPC adapter }
  - { resource: /.test-agent/callable-read/host.ts, title: Actual isolated-host integration harness }
---

# First Callable Cotail Session Read

## Outcome And Gate

The parent authorized `cotail-tools-read` after reviewing
[runtime-probe0](/.design/bookmarks/runtime-probe0.gpt6a.md). One shared async read,
`cotail_session_get`, and `CotailRead.sessionGet` are implemented and callable in
fixtures. **Nothing was installed into the live service.** Parent independent
Standards/Spec review remains pending; bookmark writes, links, consumer UI,
global namespace work, and next-response binding remain outside this slice.

## Exact Interface And Files

```ts
import { sessionGet } from "./src/tools/session-get/index.ts";

const result = await sessionGet(
  { profilePath: "/path/to/fixture-profile.json", maxOutputBytes: 65_536 },
  { schema: "cotail.session-get.input/v1", sessionID: "ses_child" },
  { signal: controller.signal },
);
```

The first argument is **operator configuration**, never tool/RPC input. The
versioned input permits only `schema` and a nonblank Session ID up to 256
characters. The result is success with a complete canonical observation, or
`{ ok: false, error }` with a versioned plain declared error. No Effect value or
native database handle escapes. Expected failures are data; unexpected defects
remain failures rather than being swallowed.

| Surface | Implementation |
|---|---|
| Portable Zod wire contracts | [contract.ts](/src/tools/session-get/contract.ts), runtime-free except Zod |
| Public async `sessionGet` | [index.ts](/src/tools/session-get/index.ts), validates input/config budgets before lazy runtime import |
| Private Cotail Effect/source scope | [runtime.ts](/src/tools/session-get/runtime.ts), composes existing trusted selection and production `getSession` |
| Model tool and host cancellation | [plugin index.ts](/packages/opencode-plugin/src/index.ts), public plugin/schema APIs only |
| Typed portable `CotailRead` | [rpc.ts](/packages/opencode-plugin/src/rpc.ts), ID `cotail.read`, method `sessionGet`, declared `read_failed` error |
| Operation tests | [session-get-tool.test.ts](/tests/session-get-tool.test.ts) |
| Contract/import tests | [contract.test.ts](/packages/opencode-plugin/test/contract.test.ts) |

Canonical report fields, child parentage and per-read provenance are preserved.
Every success explicitly says `identityStatus: "selection-scoped"`: the
profile-derived source key is not durable catalog identity and does not prove
the source is the connected server. Existing profile/`--db` locator semantics
are reused unchanged; there is no profile generation, refresh, executable call,
schema discovery, raw SQL interface, root-only filter, or CLI output parsing.

The result budget is 65,536 UTF-8 bytes by default, operator-configurable from
4,096 to 1,048,576. Oversized reports fail; report fields are never silently
truncated. Error diagnostics are bounded to 256 characters. Tool structured and
text representations each carry the bounded result. Configuration details and
error codes are documented in the [plugin README](/packages/opencode-plugin/README.md).

## Dependencies And The Actual Host Mismatch

- Node tests: **v26.6.0**; isolated real host: **Bun 1.4.1**.
- Plugin and schema: pinned public **`0.0.0-dev-19216`**, inspected before install.
  The older installed `0.0.0-dev-18695` lacks `ctx.rpc` and RPC exports, so it was
  not used or worked around with a private API.
- Host-facing Effect: **`4.0.0-rc.112`**; Cotail private Effect remains
  **`4.0.0-beta.101`**. Zod **4.1.8** supplies portable schemas. The plugin's
  public SDK declarations require dev-only `@types/json-schema` **7.0.15**.
- Only targeted `pnpm add` operations were used. The SDK brings its own sizeable
  transitive dependency tree; no existing root runtime versions were upgraded.
  pnpm recorded exact-version release-age exceptions for six SDK packages.
  `protobufjs`'s transitive install script remains explicitly denied, like the
  existing denied `msgpackr-extract` script. No live configuration was changed.

An actual host behavior mattered: [Tool runtime](file:///home/rektide/src/opencode-term-v2/packages/core/src/tool/runtime.ts#L28)
uses `instanceof` for its own `Tool.Error`, rewrapping errors from separately
loaded SDK copies and dropping their metadata. Initial success tests did not
reveal this; error-path integration did. The public adaptation is to put the
versioned Cotail error JSON in the documented **message** field, which survives
normalization. RPC uses its **host-owned error factory**, preserving structured
`read_failed.data`. No Core patch, private method, or pretend successful read was
introduced to conceal that mismatch.

## Verification Receipt

| Check | Result |
|---|---|
| Root `pnpm test` | **73/73**, including seven new operation tests |
| Root `pnpm exec tsgo --noEmit` | Pass |
| `packages/query-kysely` `pnpm check` | **110/110** plus typecheck pass |
| `packages/opencode-plugin` `pnpm test` | **2/2** |
| Plugin `pnpm typecheck` | Pass |
| Actual isolated host harness | **14 checks pass** |

Source-query tests prove actual read-only/query_only acquisition, no source
inspection SQL, lazy Message bodies, unchanged fixture bytes, typed source/
not-found/report/schema errors, output rejection, cancellation and one source
close. A fresh Node subprocess rejects SQLite, Core, Server and Effect imports
while loading the portable RPC export; that test passes.

Real-host command (from Cotail):

```sh
bun .test-agent/callable-read/host.ts
# Or select the checked-out host explicitly:
OPENCODE_HOST_ROOT=/path/to/opencode-v2 bun .test-agent/callable-read/host.ts
```

The harness uses public `Host.load` for the actual plugin, then the real local
Core plugin lifecycle, Tool snapshot/executor and RPC registry/client. Only test
infrastructure imports Core. Operator options are injected as a loader would.
Host database is in-memory, global paths are scratch-local, configuration is
in-memory and model fetching is disabled. The configured Cotail source is a
separate indexed fixture, whose bytes are unchanged by calls.

Host jj source receipt: `d688b44adf2425becc42136b07ff445966d0370e`.
Final [integration report](/.test-agent/callable-read/host-MhQHPa/report.json).
[Harness](/.test-agent/callable-read/host.ts) SHA-256:
`32f95a4d40b82c273c1679d7789bdcc8a176fe2f6087f18ebc6108dba67a250d`.
Report SHA-256: `4ed1284615074584dc128b952991443440e7f7174e7caf92e60c064761a1cafa`.

The 14 checks cover parent/child parity, actual tool/RPC input rejection,
not-found, profile/source/report/schema/budget failures, stale snapshot
cancellation after reload, in-flight **tool and RPC interruption**, in-flight
**tool and RPC cancellation on unload**, and removal of registrations.
After unload, RPC correctly reports `rpc.unavailable`. Ordinary plugin
deactivation was tested; shutdown intentionally suppresses state rebuilds, so
post-shutdown snapshots are not used as a registration-removal oracle.

FIFO fixture handshakes hold actual profile-file I/O in flight without replacing
the operation. Host interruption aborts the Cotail signal; unload's lifetime
signal returns declared cancellation. Writers are then closed to release the
test OS reads. This proves signal propagation, not preemption of synchronous
SQLite or cancellation of every individual OS read. The operation tests
separately prove source closure when interrupted after acquisition.

## Checkpoints And Remaining Limits

- `0e507467`: parent authorization and claim recorded.
- `37f81b27`: shared operation/contracts/tests and existing decode-error export.
- `8f31eb4b`: public plugin/RPC and pinned dependencies; known error-path issue
  preserved before refinement.
- `a8a74271`: portable tool-error adaptation and additional configuration test.

The real-host harness/results remain **ignored scratch**, not a portable CI host
fixture. No HTTP/TUI round-trip, installed service, live data, or distributed
source-binding guarantee was tested. The package remains private/unpublished.
The next gate is parent code review, then explicit consumer source/server
binding—not automatically adding writes, a helper process, or consumer UI.

[links-tools0](/.design/bookmarks/links-tools0.gpt6a.md) retains the broader
capability split; [runtime-probe0](/.design/bookmarks/runtime-probe0.gpt6a.md)
supplies its in-process prerequisite evidence. This report records the first
authorized executable slice without treating every adjacent design as accepted.
