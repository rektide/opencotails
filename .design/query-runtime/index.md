# Query Runtime Index

## Orientation

- [Query registry uses and alternatives](/.design/query-runtime/applications0.gpt56.md):
  explains current unused status, concrete and speculative applications,
  overkill thresholds, adoption path, adaptations, and alternative designs.

## Accepted Design

- [Scoped query factory registry](/.design/query-runtime/factory-registry0.gpt56.md):
  selects a higher-order Effect Layer over pure factory descriptors, with typed
  keys, capabilities, dependency validation, explicit replacement, immutable
  discovery, and Scope-owned cleanup.

## Related Domains

- [V2 relational query world](/.design/query/design3.gpt56.md): defines what a
  production query factory acquires and which logical relations callers query.
- [Query execution contract PRD](/.design/query2/design.md): defines the
  provider-owned read scope beneath each operation and keeps transaction,
  provenance, and stream lifetime outside registry responsibility.
- [Earlier addressed query candidate](/.design/query/design3-self.md): retained
  as design lineage preceding the implemented V2 world.
- [OpenCode V2 model and integration](/.design/query/opencode-v2-model0.general.md):
  source evidence for Effect 4 composition and embedded database constraints.
- [Apache Arrow output tracer](/.design/output/arrow0.gpt56.md): keeps renderer
  schemas downstream from query providers and result capabilities.
