# Cotail Query Design

This directory contains cotail's session-selection, content-qualification,
witness/evidence, storage-authority, and future indexing design.

Start with [`design2.md`](/query/design2.md). It is the recommended object-model
design: metadata selectors, title/content qualification, witness scopes,
evidence provenance, operation boundaries, alternatives, and remaining choices.

[`draft1.syn.md`](/query/draft1.syn.md) is the prior cross-assessment that feeds
`design2`; the work did not restart. [`design1.md`](/query/design1.md) is retained
only as failed/deprecated lineage because it went off-target into implementation
and FTS planning.

Current normative support:

- [`authority0.md`](/query/authority0.md) is the source-backed V1/V2 storage
  authority decision.
- [`adjudication0.md`](/query/adjudication0.md) records the private Kysely,
  `node:sqlite`, package, and safety decision behind the implemented foundation.
- [`implementation2.md`](/query/implementation2.md) is the accepted production
  audit; it is evidence, not the forward build design.

Current implementation evidence remains useful, but it is distinct from the
intended object model. Direct search, title search, history, and session
resolution are implemented; title-plus-content qualification and stable evidence
IDs are recommendations in `design2`, not claims about current behavior.

Use [`index.md`](/query/index.md) for progressive disclosure and
[`log.md`](/query/log.md) for dated changes.
