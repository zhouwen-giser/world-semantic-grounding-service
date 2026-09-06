# W03 In Progress

Implemented exact independently allowlisted 1.2 transport, request and full
response validation, strict persisted selection parsing, full semantic input
hashing, and the production Worker public result boundary. The existing 1.0/1.1
wire schemas and legacy hashing path remain unchanged. The new profile defaults
off through an empty service-principal allowlist.

The Worker now whitelists ReferenceProduct and Evidence fields, hashes snapshot
summaries and builds WorldAnalysisFindings from validated source envelopes before
the pipeline computes durable bytes. Internal safePayload previews are not the
public analysis authority. The real run fingerprint is included in 1.2 execution
and the frozen public result-hash algorithm is used by the pipeline.

Corrections made during local checks:

- Fixed the new test's cancellation route to the existing `:cancel` endpoint.
- Added literal types to the new API test backend response discriminants.
- Fixed empty analysis aggregation so it preserves ordinary FAILED/UNRESOLVED
  statuses. Cross-package tests were rerun after rebuilding dependency outputs.
- Existing N01 generated input hashes changed due to workspace manifest inputs;
  regenerated only evidence. Old released contract bytes stayed unchanged.
- Existing N03 evidence included the changed root command manifest. Its original
  generator reran 120 real focused tests before updating evidence. Live scope
  remains NOT_RUN. Neither checker was weakened or bypassed.

This is not a W03 completion report. Capability publication, persisted choice
authority, actual recovery/late-worker coverage, local production HTTP execution
and consumer handoff remain open. Fixture API backend tests prove protocol
validation only; scripted SQL tests are not a PostgreSQL integration run.
