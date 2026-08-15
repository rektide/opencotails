# Cotail Query Design

This directory contains cotail's session-selection, content-qualification,
witness/evidence, storage-authority, and future indexing design.

Start with [`prompt1.gpt56.md`](/query/prompt1.gpt56.md). It is the active design
brief for a V2-only, Kysely-forward, Effect-composed CLI and reusable query
library. No replacement design has been accepted yet.

[`design2.md`](/query/design2.md) is an unaccepted custom selector candidate now
being challenged by the Kysely-forward direction. [`design1.md`](/query/design1.md)
is retained only as failed/deprecated lineage.

Important evidence:

- [`opencode-v2-model0.general.md`](/query/opencode-v2-model0.general.md) audits
  OpenCode V2, Effect integration, result grains, and V1-removal consequences.
- [`draft-ksyley0.md`](/query/draft-ksyley0.md) and
  [`draft-ksyley1.md`](/query/draft-ksyley1.md) record the executable Kysely wave;
  the latter's private-Kysely conclusion is explicitly reopened.
- [`implementation2.md`](/query/implementation2.md) is the accepted production
  audit; it is evidence, not the forward build design.

Current implementation evidence remains useful, but it is distinct from the
intended object model. The active prompt permits breaking changes, V2-only reads,
multiple result grains, public Kysely composition, and Effect services.

Use [`index.md`](/query/index.md) for progressive disclosure and
[`log.md`](/query/log.md) for dated changes.
