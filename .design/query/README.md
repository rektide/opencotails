# Cotail Query Design

This directory contains cotail's session-selection, content-qualification,
witness/evidence, storage-authority, and future indexing design.

Start with [`design3.gpt56.md`](/query/design3.gpt56.md). Its V2-only public
Kysely world, logical relations, Address/Target model, witnesses, evidence, and
Effect-scoped standalone execution are now the implemented direction.

Then read [the standalone query execution design](/.design/query2/design2.gpt56.md)
for the active refinement of `node:sqlite` read scopes, transactions,
provenance, conventional Effect streaming, flexible diagnostics, and lifecycle.
The [original execution contract](/.design/query2/design.md) remains as broader
standalone/hosted design lineage.

[`prompt1.gpt56.md`](/query/prompt1.gpt56.md) remains the brief that initiated
this direction. [`design3-self.md`](/query/design3-self.md) is the earlier direct
candidate retained as design lineage.

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
forward execution requirements. The execution design is deliberately narrower
than the relational design and states which adjacent work it does not directly
own.

Use [`index.md`](/query/index.md) for progressive disclosure and
[`log.md`](/query/log.md) for dated changes.
