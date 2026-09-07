# Cotail read plugin

One read-only OpenCode V2 tool and RPC over the same Cotail operation:

- **Tool:** `cotail_session_get`
- **RPC:** `CotailRead.sessionGet`, from `@opencoattails/opencode-plugin/rpc`
- **Operation:** `sessionGet`, from `opencoattails/tools/session-get`

Implemented and verified against disposable fixtures and an isolated real host.
This workspace package is private, not published or installed into the live
OpenCode service. It has no bookmark writer or next-response binder.

## Source selection and input

Operator plugin options accept `profilePath`, optional `databasePath` locator
override, `busyTimeoutMs`, and `maxOutputBytes`. Omitted profile uses Cotail's
existing conventional XDG profile selection; no executable discovery, validation,
generation, refresh, or fallback occurs during reads.

Future operator-managed configuration, **not applied by this implementation**:

```json
{
  "plugins": [{
    "package": "/path/to/cotail/packages/opencode-plugin",
    "options": { "profilePath": "/path/to/cotail-source-profile.json" }
  }]
}
```

Both callable inputs are exactly:

```json
{"schema":"cotail.session-get.input/v1","sessionID":"ses_child"}
```

Extra properties are rejected. The caller cannot choose file paths, SQL,
executables, arbitrary operations, or source configuration. Explicit children
work without a root-only listing filter.

**The configured Cotail source is not proven to be the connected OpenCode
server.** Every result says `identityStatus: "selection-scoped"`. Its
profile-derived SourceKey is not a durable catalog identity. A future Opensesser
integration must establish that source/server binding separately, not compare
channel or profile names.

## Result and errors

A successful result has `schema: "cotail.session-get.result/v1"`, `ok: true`,
`identityStatus`, and the canonical Session `observation` containing its Target,
complete report, and fresh read provenance. It does not fetch Message bodies.

The shared operation returns expected failures as `{ ok: false, error }`, where
`error` has `schema: "cotail.session-get.error/v1"`, `code`, and `message`.
Codes distinguish invalid input/configuration, source-profile failure,
source-unavailable, session-not-found, query-failed, invalid-report,
output-too-large, and cancelled.

- RPC maps these to declared `read_failed` errors with the error object in `data`.
- Tools fail with that error object serialized as JSON in the documented
  `Tool.Error.message`. This survives hosts that rewrap a separately loaded SDK's
  Error and discard its metadata; consumers must not depend on foreign metadata.
- Host input-schema failures occur before the operation: RPC uses
  `rpc.invalid_input`; the tool uses its ordinary input-validation error.

Default result budget is 65,536 UTF-8 bytes; the operator may select 4,096 through
1,048,576 bytes. Oversized reports fail instead of silently truncating canonical
fields. Tool structured output and model text each represent that bounded result.
Error diagnostics are limited to 256 characters. Default busy timeout remains
the source adapter's 5,000 ms; the operator may configure a nonnegative integer.

## Runtime and lifecycle

The plugin pins public SDK/schema `0.0.0-dev-19216` and Effect `4.0.0-rc.112`.
The older inspected `0.0.0-dev-18695` package does not expose RPC. Cotail retains
its own Effect `4.0.0-beta.101`; only a Promise and plain values cross that boundary.
Query imports are lazy, in-process. There is no helper process, daemon, Core/Server
runtime import in this plugin, or query runtime import in the portable RPC export.

The Effect-facing wrapper passes its cancellation signal into Cotail and combines
it with plugin lifetime cancellation. Unload cancels in-flight reads and prevents
stale tool snapshots from starting fresh reads. The tested source scope closes
on cancellation; synchronous SQLite work cannot be preempted mid-call.

## Verification

```sh
pnpm --dir packages/opencode-plugin test
pnpm --dir packages/opencode-plugin typecheck
node --test tests/session-get-tool.test.ts
pnpm exec tsgo --noEmit
```

The 14-check real-host integration harness is retained in ignored scratch:

```sh
OPENCODE_HOST_ROOT=/path/to/opencode-v2 bun .test-agent/callable-read/host.ts
```

It loads the actual plugin through public `Host.load`, uses real host Tool/RPC
registries, disables model fetch/config discovery, and creates only disposable
fixture state. It is local integration evidence, not a portable CI host fixture,
HTTP/TUI round-trip, live installation, or authorization to run against live DBs.
See [the implementation receipt](/.design/bookmarks/callable-read0.gpt6a.md).
