# Query Runtime Index

## Accepted Design

- [Scoped query factory registry](/.design/query-runtime/factory-registry0.gpt56.md):
  selects a higher-order Effect Layer over pure factory descriptors, with typed
  keys, capabilities, dependency validation, explicit replacement, immutable
  discovery, and Scope-owned cleanup.

## Related Domains

- [Addressed Kysely query world](/.design/query/design3-self.md): defines what a
  production query factory will acquire.
- [OpenCode V2 model and integration](/.design/query/opencode-v2-model0.general.md):
  source evidence for Effect 4 composition and embedded database constraints.
- [Apache Arrow output tracer](/.design/output/arrow0.gpt56.md): keeps renderer
  schemas downstream from query providers and result capabilities.
