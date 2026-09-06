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

This entry point is not yet wired to the production multi-round context loader.
Private source authority retention, text ordinal disambiguation/conflicts,
semantic requery decisions and action-target reuse remain open. No W04 Required
row is marked PASS solely on this helper's tests.

Implementation commit: a211c55. `selection-tests.json` records 41 passing tests
across the existing prior validator, new selection validator and Worker recovery
adapter. `selection-build.json` records a passing independent build. The W03
`recovery-check.json` records the complete check: 852 passing and 29 skipped
tests, no failures, 836 frozen contract assertions and 68 legacy byte checks.
Real PostgreSQL, Gateway, model and SACS remain NOT_RUN.
