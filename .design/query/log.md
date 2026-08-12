# Query Design Log

## 2026-08-11

- Added [`authority0.md`](/query/authority0.md) after auditing the current,
  byte-identical opencode migration/projector sources in both local archives and
  running aggregate-only analysis against the live database. The decision
  rejects ID union and message-presence precedence: completed `session_v2`
  ownership selects canonical `session_message` content/counts, while only a
  V1-owned session falls back to `message`/`part`. Steps 8-10 may resume under
  mandatory zero-row, omission, revert, incomplete-migration, and sequence-gap
  fixtures.
- Implemented the adjudicated workspace through bounded V1 search in seven
  commits. [`implementation0.md`](/query/implementation0.md) records package
  boundaries, commit IDs, checks, and divergences.
- Stopped before V2 normalization and history migration after read-only analysis
  of 5,254 real sessions found 1,222 legacy/all-native count mismatches and 395
  legacy/native-user-assistant mismatches. This activates the adjudication's
  transition-authority stop condition; no universal precedence was encoded.
- Added [`adjudication0.md`](/query/adjudication0.md), selecting refined Kysely
  over the baseline and Drizzle while narrowing initial implementation to domain,
  live-store, and test-contract packages. Both spikes were rerun byte-identically;
  minimum-Node read-only execution, real mixed-layout authority, complete bounded
  boolean lowering, and V2 array extraction remain mandatory gates.
- Added [`draft-ksyley1.md`](/query/draft-ksyley1.md), refining the Kysely design
  after reviewing Drizzle's successful fixture and criticisms. The refinement
  reduces the runtime graph, narrows the async facade, makes native connection
  ownership explicit, uses domain-shaped Kysely selections, and assigns Kysely
  private index queries while keeping migrations as narrow cotail-owned SQL.
- Added [`draft-drizzle0.md`](/query/draft-drizzle0.md). The supported
  `better-sqlite3` spike passed the representative mixed-layout query, while a
  custom `node:sqlite` session was rejected for internal Drizzle API coupling;
  native-addon installation and exact-version publication remain decisive costs.
- Added [`draft-ksyley0.md`](/query/draft-ksyley0.md), the initial executable
  Kysely alternative, and verified its isolated `node:sqlite` fixture and strict
  type check with byte-identical generated SQL/results.
- Started the typed query-builder wave under epic `cotail-query-builder`.
- Established [`packet-query-builders0.md`](/query/packet-query-builders0.md) as
  the shared handoff packet for Kysely, Drizzle, refinement, adjudication, and
  implementation agents.
- Added bounded `all`/`any`/`none`, live opencode metadata authority, a shared
  renderer-facing `SearchResult`, and domain-decomposed workspace packages as
  explicit design constraints.
- Confirmed the local source archives at `/home/rektide/archive/kysely-org/kysely`
  and `/home/rektide/archive/drizzle-team/drizzle-orm`. Kysely exposes a small
  `better-sqlite3`-shaped dialect interface; Drizzle's archived source has no
  native `node:sqlite` driver. Both proposals must resolve this rather than
  assuming compatibility.

## 2026-08-10

- Produced [`draft1.gpt56sol.md`](/query/draft1.gpt56sol.md), including the
  per-session V1/V2 normalization correction.
- Produced [`draft1.syn.md`](/query/draft1.syn.md), synthesizing the independent
  `design-alt0` wave.
