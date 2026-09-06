# W00 Baseline and Actual Runtime Path

## Source

WSGS only. `git fetch --all --prune` succeeded at task start. The clean T5
head `0db24edf8490766346904c5ab71fd78fbf3afb5d` matches its remote branch and
OPEN/Draft PR #14. Main is `565e52705bb7656d4623a04655001325ca61acd0`.
Both main and historical-trace `825682205deeab6ff2e6808e5f5d5c38abfb1779`
are ancestors. New dedicated branch is
`codex/wsgs-v0.2.4-stable-world-analysis-service`. No reset, force push,
repeated merge/cherry-pick, upstream write or remote merge occurred.

Task package integrity passed: 29 checked artifacts plus checksums, 8 phases,
72 Required requirements, 24 case designs. Input templates remain unchanged.
No applicable AGENTS.md was found in the repository or its ancestor directories.

## Production Call Path

1. `services/grounding-api/src/production.ts:createProductionBackendFromEnvironment`
   assembles `ProductionGroundingBackend` and `PostgresProductionGroundingStore`.
2. `services/grounding-api/src/server.ts:createGroundingApi` creates the actual
   Fastify listener/routes; authentication precedes `negotiateGroundingContract`.
   POST validates request, source-text SHA-256, read-only policy and idempotency.
   `schemas.ts:compileApiSchemas` currently has one closed request validator and
   separate 1.0/1.1 result, job and capabilities validators.
3. `packages/grounding-pipeline/src/backend.ts:ProductionGroundingBackend.create`
   validates identity, derives scoped payload hash, checks replay before readiness,
   captures immutable admission authority, seals canonical request, and submits.
4. `postgres-backend-store.ts:PostgresProductionGroundingStore.submit` persists
   request metadata including contractSelection. `replay/get/cancel` check scope
   and stored selection. Different payload conflicts precede profile mismatch.
5. `services/grounding-worker/src/postgres-store.ts:PostgresGroundingWorkerStore`
   claims under lease/fencing, parses persisted selection and reconstructs input.
   `worker.ts:GroundingWorker` invokes the existing GroundingPipeline, heartbeats,
   cancellation/deadline and terminal settlement. Late completion cannot replace
   a cancelled/expired job.
6. `services/grounding-worker/src/production-module.ts:createPipelineStageExecutor`
   assembles production stages: LOAD_CONTEXT, reference parsing/resolution,
   REQUIREMENT_PLAN, CAPABILITY_MATCH, WORLD_QUERY_COMPILE, GOWM_EXECUTE,
   EVIDENCE_NORMALIZE and result assembly. Historical paths call
   `executeHistoricalTrace` / `executeAdvancedHistoricalAnalysis`; the latter
   compiles fixed T2/T3/T4 recipes and uses the existing signed Gateway execution.
7. `production-module.ts:advancedEvidence` currently puts bounded internal
   HISTORICAL_* maps in CAPABILITY_RESULT safePayload. `resultDocument` builds
   public core and optional geospatial extension. This is the additive mapping
   point for a closed worldAnalysisFindings component, not a new query engine.
8. `packages/grounding-pipeline/src/pipeline.ts:materializeResult` excludes
   resultHash and execution.elapsedMs from hash material, incorporates the run
   fingerprint/status, serializes canonical final bytes, and enforces byte limit.
9. Worker `result-schema.ts:assertNegotiatedGroundingResult` validates before
   `postgres-store.ts` persists final bytes/hash. GET returns the saved Job and
   result under the saved profile, without re-running analysis or adding fields.

## Contract and Identity Gaps to Close

- 1.2 is not occupied in the current contracts. Old request/result objects are
  closed; adding fields by allOf cannot work. Separate complete new schemas and
  explicit validators are necessary.
- GroundingContractSelection currently supports only 1.0/1.1. Its strict parser
  is used by API/backend/store/recovery, so all entry points must be extended.
- Existing T5's evidence-product selection is not a public ReferenceProduct
  selection. 1.2 must add independent analysisSelections and closed Choices;
  no candidate/rank IDs in selectedProductIds.
- Pipeline resultHash is not the raw SHA-256 of result_bytes. Existing historical
  prior loaders use raw-byte checks. W01 must explicitly freeze the public hash
  and W03/W04 must verify the saved authority without conflating these hashes.
- The existing pipeline canonical utility uses localeCompare key ordering;
  public findingSetHash needs an explicit cross-consumer algorithm and vectors.
  Preserve legacy result behavior and specify the new extension's hash scope.
- T5 uses bounded internal records, not the required public discriminated union.
  Upstream raw evidence must not leak through another field in 1.2.

## Verification and Limits

This task reran `npm run check`; see baseline-check.log/json: 61 files passed,
4 optional files skipped; 780 tests passed, 29 skipped, 0 failed. The skipped
database integration tests require isolated TEST_DATABASE_URL/upgrade database.
No real PostgreSQL/Gateway/model/SACS/device verification is claimed.

Existing wider acceptance remains 195 PASS / 67 BLOCKED / 17 NOT_RUN; existing
development closure 63/63 with 14 deferred production items. A zero check exit
does not convert these legacy qualification boundaries into real-service PASS.
Independent build/test and task-validator logs are recorded separately.

Legacy artifacts are enumerated and exact-byte SHA-256 locked in
legacy-contract-hashes.json. VERSION/package/image remain 0.2.1; v0.2.4 is
only this work item. New runtime implementation is gated on W01 freeze.
