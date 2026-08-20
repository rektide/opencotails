# Query Runtime Designs

This directory covers Effect-owned query runtime composition: factory descriptors,
scoped query instances, registry discovery, replacement, and lifecycle. It does
not define relational selection or output formats.

Start with [Query registry uses and alternatives](/.design/query-runtime/applications0.gpt56.md)
for a plain-language explanation of what exists, why it is not used by production
yet, concrete and speculative applications, adoption guidance, and alternative
implementations. Then read
[Scoped query factory registry](/.design/query-runtime/factory-registry0.gpt56.md)
for the accepted technical design and executable tracer.

See [the index](/.design/query-runtime/index.md) for progressive disclosure and
[the log](/.design/query-runtime/log.md) for changes.

[The standalone query execution design](/.design/query2/design2.gpt56.md)
defines the adjacent per-read seam. Registry scope may acquire the query module;
it does not own each operation's connection lease, transaction, provenance, or
stream. The execution design intentionally avoids a provider abstraction until
a second implementation is concrete.
