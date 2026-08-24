# Reference grounding

Reference grounding is a fixed two-operation Gateway flow:

1. `reference.resolve@1.0` receives at most 32 bounded mentions and at most 20
   candidates per mention.
2. `reference.validate@1.0` validates every returned ReferenceKey against the
   same transport-derived identity and data scope.

Both calls use the byte-locked provider, operation version, input hash, and
output hash. The public body never accepts identity or data-scope claims. Sync
and async Gateway responses are accepted only when the operation, provider,
schema hash, and terminal state match the lock.

The normalizer preserves the upstream status exactly. In particular,
`SUGGESTED_UNIQUE` is never upgraded, `AMBIGUOUS` has at least two candidates
and no selected winner, and `NO_DATA` or zero candidates becomes `UNRESOLVED`
rather than a service failure. Provider candidate order is retained.
`matchedBy`, `matchScore`, `stateConfidence`, candidate world version,
valid-until, and revalidation state remain distinct fields.

Stale, expired, missing, type-conflicting, version-conflicting, and scope-denied
validation results stay explicit. They mark the product for revalidation and
do not get silently converted into a current reference.

