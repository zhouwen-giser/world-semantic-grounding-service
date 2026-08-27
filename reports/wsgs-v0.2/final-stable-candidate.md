# WSGS v0.2 Blocked Candidate Report

## Decision

`BLOCKED`

This working tree is not a stable candidate and is not ready for production traffic or PR readiness. The acceptance ledger contains 279 Required IDs with 186 PASS, 0 FAIL, 17 NOT_RUN, and 76 BLOCKED. No PARTIAL terminal status is used.

## Candidate and exact SHA

- Base: WSGS `2fdefe3769189fa8e8be4302a9e98ca55cf686d4`.
- Implementation commit: `72b911ed9fc453d7c1d736ab551957e4ff4b8850`.
- Deployment/package commit and current local `HEAD`: `9cf1f897cfc400c61c434fe1b34b31ab7f59c99b`.
- Tracking branch remains `1b263d4ef5521cd6773b0b728aa815660f54bed4`; the calibrated reports are uncommitted, so no final candidate SHA exists yet.
- Final local/tracking/`ls-remote` SHA equality is NOT_RUN.
- Draft PR: https://github.com/zhouwen-giser/world-semantic-grounding-service/pull/2; it must remain Draft.

## GOWM 0.6.3 contract intake

The exact `@gowm/world-gateway-contracts@0.6.3` artifact from GOWM commit `17dd221330d9af540ec815a39eca96550690299a` passes the committed integrity, MANIFEST, revision, schema, generated-type, topology, and corruption checks. The logical package integrity and raw tarball byte digests remain separately identified.

The contract-intake milestone `GOWM_0_6_3_CONTRACT_LOCKED` is supported. It does not imply that the live semantic authority matches that artifact.

## Gateway client v2

Component evidence covers catalog/semantics/availability parsing, content revisions, schema and semantic drift rejection, binding refresh semantics, locked routes, direct/query/job/cancel/receipt APIs, retry, circuit, deadlines, bounds, trace context, and body-authority rejection.

The real GOWM gate observed seven live checks succeed, but each is diagnostic-only after the live semantic catalog and published semantic lock produced different hashes under their respective canonicalization. The same gate records two blockers: the semantic-lock mismatch and absence of direct-operation `202` support. No trusted live Gateway acceptance is claimed.

## Delegated identity

The implementation separates service principal, actor, data scopes, dataset scopes, permissions, and authorization-context hash. It signs bounded RS256 request/depth/scope/operation claims and does not persist the delegation token or forward a raw SACS bearer.

Positive live use inherits the diagnostic-only GOWM classification. The full real negative verifier matrix for signature, issuer, audience, time, request, and depth has not run.

## Executable pipeline

The production backend, worker, fourteen-stage pipeline, encrypted durable store, checkpoint/event journal, lease fencing, idempotency, cancellation, retry, settlement validation, and operation stopping points exist and have component or isolated PostgreSQL coverage.

There is no trusted API → queue → worker → real model/GOWM → persisted result → API GET proof. Injected stage executors prove adapters only. Actual API/PostgreSQL restart cases are not complete.

## Reference grounding

Component tests preserve ambiguity, suggestion, candidate order, match/state confidence, NO_DATA, stale/expired state, prior bytes/hash, scope hiding, and selected-product validation.

Trusted real resolve/validate remains blocked. The locked `reference.validate@1.0` and `result.validate@1.0` operations provide `CONSISTENT_AT_START`, not the required `PINNED` historical replay. The implementation correctly fails closed; it does not silently substitute latest state.

## Requirement planner and compiler v2

Component tests cover neutral requirements, typed capability gaps, maturity/availability/semantic matching, typed ports and units, ambiguity/no substitution, cycles, weighted budgets, exact-verification recipes, and deterministic plan hashes.

Production input wiring now carries requirement-graph requirements, inputs, and dependencies into typed compiler bindings and ports, with 17/17 compiler tests and the focused 65/65 compiler/worker run passing. Real availability, exact verification, and stable recipe execution remain blocked because the production readiness path fails closed before trusted live execution.

## Real model, GOWM, and PostgreSQL

- Real model: the latest run passed 4/4 Chinese cases (`2号车`, `滨河路`, `A区`, prompt injection); prior evidence records three consecutive consistent 4/4 runs with strict schema, exact UTF-16 spans, and authority scanning.
- Real GOWM: 7 diagnostic PASS / 2 BLOCKED / 0 FAIL; there is no trusted real-E2E PASS. The expected semantic hash is `sha256:540e9b169cfefa5707e7ba7bd59d304c7671d8d0f2f1f0f4f16d5c5210b08b3e`, while the live runtime reports `sha256:0153c0ab1884f1ca8222d59a28a2d14774099b7b7cd66faa8a75a020769b9d90`.
- Production readiness: the actual `/health/ready` path returned HTTP `503` with reason `SEMANTIC_CATALOG_DRIFT`, proving the required fail-closed behavior without proving readiness.
- PostgreSQL: isolated current-schema suites passed 18/18 and a separate fresh upgrade suite passed 2/2, including failed-002 rollback and result-schema transaction rollback. Compose fresh migration and both SQL assertion files also passed.
- Other database write/readiness cases without current final-run proof remain NOT_RUN in the ledger.

Real-model success is independent evidence and cannot compensate for a failed GOWM authority lock or missing production-chain execution.

## Security, recovery, and performance

Automated evidence covers scope narrowing, body-authority rejection, request/response bounds, rate limits, redaction, signed cursors, generation fences, cancellation monotonicity, no provider route/database, no SDAR/A2A/SMPP dependency, and no terrain/visibility implementation.

The candidate is not qualified for external IdP/JWKS federation, multi-node or multi-region high availability, production SLOs, production load, disaster recovery, or operational performance p50/p95. Container/API/worker/PostgreSQL restart recovery and the large-payload object-store path are incomplete.

## Northbound compatibility

The frozen `sacs-wsgs-grounding/1.0` schemas, examples, OpenAPI, and generated types pass their contract checks. The public capabilities response intentionally retains WSGS `0.1.0` and GOWM `0.4.0` compatibility constants; internal candidate/runtime authority is separately versioned as WSGS 0.2.0 with the exact GOWM 0.6.3 consumer bundle.

## Acceptance decision

`reports/wsgs-v0.2/required-acceptance-ledger.json` is structurally complete: every Required ID occurs exactly once with evidence and a terminal PASS, FAIL, NOT_RUN, or BLOCKED status. Structural completeness is not acceptance success. Required blockers and not-run cases prevent candidate promotion.

## Explicit non-claims

- No trusted real multi-process grounding business scenario is complete.
- No direct asynchronous operation lifecycle is supported by locked GOWM 0.6.3.
- No PINNED prior-grounding replay is supported by the locked validation operations.
- No all-stable-recipe real E2E, restart matrix, large-evidence production run, or performance report is complete.
- No external IdP, HA, SLO, production deployment, or production-device qualification is claimed.
- No readiness or completion marker is emitted.

## Protected actions not performed

No merge, tag, release, npm publication, production deployment, force-push, or modification of GOWM/SACS/SDAR/SMPP was performed. Draft PR #2 was not made Ready.

## Marker disposition

The exact GOWM contract-lock milestone is retained. Every marker whose name claims readiness or completion is intentionally withheld until all Required cases pass and the final candidate SHA is proven.
