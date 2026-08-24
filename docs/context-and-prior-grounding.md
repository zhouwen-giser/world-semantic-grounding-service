# Context and prior grounding

The context capsule is bounded to KnownReference values, hash-only prior
grounding pointers, Map selections, external correlation hints, and opaque
external predicates. Unknown fields—including full conversation history—are
rejected, and the serialized capsule has a configured byte ceiling.

A prior pointer may contain only `groundingId`, `resultHash`, and selected
product IDs. WSGS loads retained result bytes from its own store using the
trusted data scope, recomputes the byte SHA-256, and then selects products from
that server result. The caller cannot supply or replace prior result content.
Cross-scope absence is indistinguishable from not found.

Expired KnownReference and prior products are marked for mandatory
`reference.validate`. Missing selected IDs fail rather than being fabricated.
Map selections are checked against a scope-aware revision source and retain an
explicit `CURRENT`, `STALE`, or `NOT_FOUND` status.

Raw source text has independent retention from grounding results. PostgreSQL
acceptance verifies that expiring source ciphertext does not remove retained
result bytes/hash, while the result remains invisible to another data scope.

