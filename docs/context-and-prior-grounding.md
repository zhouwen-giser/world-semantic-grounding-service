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


The production worker clears expired request ciphertext and deletes its encrypted
pipeline checkpoint in one transaction, only after the job is terminal. Accepted
or running jobs may finish within their existing deadline; retention never extends
that deadline. Analysis selections still expire at their original validity limit,
even while an active job retains its checkpoint. Unexpired checkpoints remain
available for recovery and authorized follow-ups. Result bytes, hashes, idempotency
replay and append-only audit events are retained.

Cleanup runs immediately at worker startup and then every 60 seconds, in batches
of 100. With a healthy worker and no backlog, cleanup occurs within one scan
interval after both expiry and termination. Downtime or backlog delays removal;
later scans also remove old checkpoints whose request ciphertext was already
cleared. This is application-level deletion, not erasure from PostgreSQL backups.
