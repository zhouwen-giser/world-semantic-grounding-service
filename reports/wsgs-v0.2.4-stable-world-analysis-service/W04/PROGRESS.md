# W04 Selection Authority Preparation

Status: IN_PROGRESS, not a completed acceptance phase.

`packages/prior-grounding/src/validator.ts` now has a separate analysis selection
entry point that reuses the existing identity and scope checks. It accepts only
the frozen five-field selection plus its priorGroundings pointer. It parses
server-stored bytes, runs the complete public 1.2 validator (including the public
result hash and finding closure), checks stored hash and principal/actor/scope,
then resolves the exact saved candidate. No safeSummary, coordinates, rank or
display label supplied by the client can replace that candidate.

TTL checks include server retention, Choice expiry and linked finding/reference
expiry when present. selectedProductIds may be empty for analysis selection;
nonempty values must still identify real ReferenceProducts. Pretty-printed
stored JSON remains valid under the frozen canonical result hash, unlike the
old raw-byte-hash decoder.

The initial checkpoint recorded below predates production wiring. No W04
Required row is marked PASS solely on this helper's tests.

Implementation commit: a211c55. `selection-tests.json` records 41 passing tests
across the existing prior validator, new selection validator and Worker recovery
adapter. `selection-build.json` records a passing independent build. The W03
`recovery-check.json` records the complete check: 852 passing and 29 skipped
tests, no failures, 836 frozen contract assertions and 68 legacy byte checks.
Real PostgreSQL, Gateway, model and SACS remain NOT_RUN.

## Production Wiring Increment

The Worker now passes its existing encrypted checkpoint journal to the stage
factory. For a single structured selection, LOAD_CONTEXT reads the prior result
through principal/actor/scope/authorization-context restrictions, validates the
public Choice, then restores the matching encrypted checkpoint using its actual
run fingerprint. Both the decrypted state hash and the assembled result hash
must match. Missing/corrupt source authority is not reconstructed from summaries.

Rank selections can reuse complete source envelopes and carry real prior
ReferenceProducts into the new result. Explicit action intent uses the selected
rank's actual visited point; ordinary selection never inherits an old action
request. Metric/series/catalog/phase/execution/update changes do not reuse old
rankings. Series selection triggers a new query. Text/structured rank conflicts
and unrelated text are clarified. Choice expiry is checked again before reuse.

Tests exercise real encryption/journal restoration against scripted SQL and
two-round complete public projections. They do not yet exercise a real HTTP
listener or the entire production stage factory. Open: event/reference/task
choices, multiple structured selections, natural-language-only ordinal selection,
requery reference propagation, and L1 production HTTP multiround evidence.
W03 and W04 remain IN_PROGRESS.
