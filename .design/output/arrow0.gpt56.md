---
type: Design
title: Apache Arrow IPC output tracer
description: A source-backed tracer bullet for emitting cotail command products as typed Apache Arrow IPC streams on stdout.
resource: /output/arrow0.gpt56.md
tags: [cotail, output, apache-arrow, ipc, cli, interoperability]
status: stable
generated: { by: model:openai/gpt-5.6, at: 2026-08-15T20:30:00Z }
verified: { by: test:node-22-and-26-cli-round-trip, at: 2026-08-15T20:30:00Z }
stale_after: 2026-11-15
sources:
  - id: arrow-js-package
    resource: https://github.com/apache/arrow-js/tree/apache-arrow-21.2.0
    title: Apache Arrow JavaScript 21.2.0 source package
  - id: arrow-ipc-format
    resource: https://arrow.apache.org/docs/format/Columnar.html#serialization-and-interprocess-communication-ipc
    title: Apache Arrow IPC format
  - id: current-query-products
    resource: /query/design3-self.md
    title: Addressed Kysely query world
  - id: query-assignment
    resource: /query/prompt1.gpt56.md
    title: Kysely-forward V2 query library design prompt
---

# Apache Arrow IPC Output Tracer

## Decision

Cotail exposes `--arrow` on `search`, `history`, and `get-session`. The flag
writes one binary **Arrow IPC stream** to stdout. Each command has a stable,
explicit table schema matching its current result grain. The implementation
shares only the byte emitter and Arrow scalar policies; it does not introduce a
general serialization framework or a universal result record.

This is usable experimental output, not a declaration that Arrow schemas are
cotail's domain model. Cotail's TypeScript products describe command meaning.
Arrow describes one tabular interchange projection of those products.

## User Need

JSONL and TSV are convenient for inspection and shell tools, but downstream
analytics systems otherwise need to rediscover types: counts become ambiguous
numbers, timestamps become strings or undocumented integers, and nullability is
implicit. Arrow gives a consumer a self-describing schema and columnar buffers
that can enter Arrow, DuckDB, Polars, DataFusion, Python, or JavaScript workflows
without a second textual parse.

The tracer asks a narrower question than "make every cotail value Arrow": can
the current Session-grain commands emit useful, typed, pipe-safe tables without
distorting their result contracts? The answer is yes.

## Wire Format

### Selected: IPC stream

IPC stream is the natural stdout representation:

- the schema precedes record batches, so a consumer can decode from a pipe;
- it does not require a footer or seekable output;
- it can later support incremental record batches; and
- `apache-arrow` 21.2.0 directly writes and reads it with `tableToIPC(table,
  "stream")` and `tableFromIPC(bytes)`.

### Rejected: IPC file

IPC file is useful for seekable storage and random access to batches. Stdout and
process pipelines are not seekable, and cotail currently emits one bounded
result set. A second `--arrow-file` mode would add surface area without improving
this tracer. A caller can redirect the stream to a file when sequential IPC is
acceptable.

Emitting both encodings under one flag was rejected because a consumer must know
which envelope it received. Content sniffing is not a substitute for a clear CLI
contract.

## Schemas

Field names use `snake_case`, matching current machine output where practical.
Field order is part of the command's Arrow contract.

### `search`

| field | Arrow type | nullable | source |
|---|---|---:|---|
| `id` | `Utf8` | no | Session ID |
| `slug` | `Utf8` | no | Session slug |
| `title` | `Utf8` | no | Session title |
| `directory` | `Utf8` | no | Session directory |
| `time_created` | `Timestamp(MILLISECOND)` | no | Current search product's UTC creation value |
| `time_updated` | `Timestamp(MILLISECOND)` | no | Current search product's UTC update value |
| `evidence_text` | `Utf8` | yes | First evidence snippet, or null when unavailable/suppressed |

The Arrow name `evidence_text` is intentionally more precise than JSONL's legacy
`snippet`. It does not claim to encode the richer Address/Observation/Evidence
model proposed for future search products.

### `history`

| field | Arrow type | nullable |
|---|---|---:|
| `id` | `Utf8` | no |
| `title` | `Utf8` | no |
| `directory` | `Utf8` | no |
| `slug` | `Utf8` | no |
| `messages_recent` | `Int64` | no |
| `messages_total` | `Int64` | no |
| `time_created` | `Timestamp(MILLISECOND)` | no |
| `time_updated` | `Timestamp(MILLISECOND)` | no |

Counts use signed `Int64`, not JavaScript `Float64`, so the wire contract is an
integer and can grow beyond 32-bit counts. Current JavaScript numbers are
converted to `bigint` only at the renderer boundary.

### `get-session`

| field | Arrow type | nullable |
|---|---|---:|
| `id` | `Utf8` | no |
| `title` | `Utf8` | no |
| `directory` | `Utf8` | no |
| `slug` | `Utf8` | no |
| `project_id` | `Utf8` | no |
| `parent_id` | `Utf8` | yes |
| `version` | `Utf8` | no |
| `time_created` | `Timestamp(MILLISECOND)` | no |
| `time_updated` | `Timestamp(MILLISECOND)` | no |

`get-session` is a one-row Session product, not a special scalar Arrow payload.
No match remains the command's existing error, not a successful empty table.

## Schema Policy

The schema is explicit even when there are zero rows. Arrow JS 21.2.0 does not
produce an equivalent empty record-batch schema when cotail constructs a table
from separately typed empty vectors. `new Table(schema)` does preserve all field
types and nullability, so the emitter uses that path for zero rows.

Null means unavailable in the product, not an empty string. Only current optional
fields are nullable: search evidence and Session parent ID. Empty evidence text,
if it exists as source data, remains an empty non-null string.

Timestamps are Arrow millisecond timestamps with no timezone annotation. Values
are Unix epoch milliseconds and therefore represent instants. Current `search`
rows already pass through the legacy second-resolution SQLite datetime rendering
before the Arrow projection, so `search` cannot recover discarded sub-second
precision. `history` and `get-session` retain source millisecond values. A future
product migration should pass numeric instants directly without changing the
Arrow field type.

IDs and versions remain `Utf8`; they are identifiers, not numeric measures.

## Result Grain

All three current commands happen to return Session-grain rows, but their
products differ: a Search hit includes evidence, History includes aggregate
counts, and Get Session includes identity/lineage fields. Combining them into one
table with every field optional would recreate the rejected universal Composite.
Distinct schemas make unsupported combinations unrepresentable and leave each
command free to evolve deliberately.

Arrow table schema is a renderer contract. It neither replaces the cotail domain
model nor establishes source authority. The query design's Address, Observation,
Evidence, and operation-owned products remain the semantic layer.

## Channels And Compatibility

Binary bytes are written only to stdout. The emitter awaits the stdout write
callback. Successful black-box runs assert empty stderr and decode all stdout as
IPC. Parse conflicts involving `--arrow` report only to stderr and leave stdout
empty. On Node 22, the CLI composition root filters the exact built-in SQLite
experimental warning so it cannot turn a successful binary pipeline into a
diagnostic-bearing one; unrelated warnings still print.

`--arrow` conflicts deterministically with `--json`, `--tsv`, and `--id-only`
where applicable. Legacy `history --json --tsv` and `get-session --id-only
--json` precedence remains unchanged. Existing human, JSONL, and TSV
characterization tests remain byte-exact.

Errors before serialization cannot emit Arrow bytes. A low-level stdout failure
can naturally leave a truncated stream; cotail does not pretend a pipe write is
transactional.

## Runtime And Memory

This tracer is **not yet streaming internally**. The live-store methods return a
bounded array; cotail creates one vector per field, builds one Arrow Table, then
materializes one IPC `Uint8Array` before writing it. Peak memory therefore
includes result objects, column buffers, and encoded IPC bytes. IPC stream was
selected so future query streams can map batches incrementally, but no such
performance claim applies to this implementation.

The installed `apache-arrow` package is version 21.2.0. Its published package has
no `engines` declaration and exposes Node ESM. The npm metadata reports a
5,818,996-byte unpacked package. In this pnpm install, the Arrow package occupies
about 8,480 KiB and direct transitive package directories add approximately
3,340 KiB (`flatbuffers`, `json-with-bigint`, `tslib`, and Arrow's runtime
`@types/node` dependency). This is a substantial cost for one output mode.

Node 22.23.2 and Node 26.6.0 both passed the complete 13-test suite. Node 22's
test process still labels fixture-side `node:sqlite` use experimental in TAP;
spawned cotail processes have clean success stderr.

## Round-Trip Evidence

Black-box tests spawn `node src/cli.ts`, capture Buffer stdout, and decode it with
the same published Arrow reader. They cover:

- zero, one, and multiple rows;
- complete field names, order, types, and nullability;
- Unicode title and directory values (`Café 猫`, `/work/日本語`);
- null evidence and parent IDs;
- `Int64` recent/total counts;
- millisecond timestamps and representative values;
- empty stderr on success; and
- conflict errors with zero stdout bytes.

An additional synthetic-fixture run produced:

| command | rows | Arrow IPC stream | JSONL | success stderr |
|---|---:|---:|---:|---:|
| `search alpha` | 3 | 1,304 bytes | 564 bytes | 0 bytes |
| `history` | 3 | 1,368 bytes | 652 bytes | 0 bytes |
| `get-session` | 1 | 1,408 bytes | 188 bytes | 0 bytes |

Arrow is larger for these tiny results because schema and message framing dominate.
This evidence establishes typed interoperability, not compression, throughput,
or lower memory use. Larger-result benchmarks are future work if Arrow becomes a
frequent path.

## Future Products

Message, Content, Tool, Shell, Event, and aggregate products should each receive
a schema at their natural grain when a command actually emits them. Shared
address components can become repeated scalar columns (`session_id`,
`message_id`, `content_index`) rather than an opaque serialized address. Rich
Evidence may use a separate evidence-grain table/stream or explicit nested Arrow
types after consumer needs are proven; it should not become dozens of nullable
columns on every product.

Grouped Session results require an explicit choice. A flat child-grain table with
repeated Session keys is friendliest to relational tools. A nested list column
preserves grouping but has broader interoperability and batching consequences.
The future command should choose based on its consumers rather than freezing the
choice in this Session-only tracer.

True streaming can replace the current single-table materialization behind the
same IPC stream envelope. Schema evolution still needs an explicit compatibility
policy before these experimental schemas are promised across releases.

## Rejected Alternatives

- **IPC file on stdout:** seekable-file strengths do not fit a process pipe.
- **Both stream and file now:** adds flags and testing without a demonstrated file
  consumer.
- **One superset schema:** creates optional-field soup and erases product grain.
- **Arrow as the domain model:** couples query semantics to a transport and makes
  nested/domain evolution answer to column encoding prematurely.
- **JSON inside one Arrow string column:** technically decodable but preserves
  none of Arrow's typed-column value.
- **Inference from JavaScript arrays:** unstable for empty/all-null results and
  infers numbers as floating point rather than the intended integers/timestamps.
- **Compression by default:** adds codec/runtime considerations without measured
  benefit for current small outputs.

## Cross-References

- [Addressed Kysely query world](/.design/query/design3-self.md) is the semantic
  basis for keeping Session, Message, Content, Tool, Shell, aggregate, and grouped
  products at explicit grains. Its renderer boundary supports command-specific
  Arrow projections, while its rejection of a universal optional Composite
  directly rules out one sparse Arrow schema.
- [Kysely-forward V2 query prompt](/.design/query/prompt1.gpt56.md) requires
  multiple results per Session and multiple natural result grains. That means
  future Arrow work must support repeated child rows or deliberate grouped
  encodings rather than assuming one Session row is universal.
- [Root README](/README.md) remains the user-facing source for current command and
  flag behavior. This document supplies the deeper wire/schema rationale and
  experimental measurements.
- [History viewer design](/.design/history-viewer/design.md) is prior art for the
  History field inventory and the intentional legacy `--json`/`--tsv` precedence.
  Arrow adds a typed projection without silently rewriting those established
  text contracts.
