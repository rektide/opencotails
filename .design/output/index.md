# Output Index

## Binary Interchange

- [Arrow IPC tracer bullet](/.design/output/arrow0.gpt56.md): stream IPC on
  stdout with distinct `search`, `history`, and `get-session` table schemas.

## Related Design

- [Addressed Kysely query world](/.design/query/design3-self.md): defines result
  grain and operation-owned products that future renderers should preserve.
- [Kysely-forward V2 prompt](/.design/query/prompt1.gpt56.md): establishes
  multiple result grains and warns against one universal optional-field shape.
- [History viewer design](/.design/history-viewer/design.md): prior field and
  JSONL/TSV contracts that the Arrow tracer preserves.
