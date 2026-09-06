# W02 In Progress

Status: PARTIAL. No W02 acceptance row is claimed PASS yet.

Completed prerequisite implementation at
89b9b9acbab6c1cbc059d6d9bc1ce2b7eefaedde:

- A byte-identical mirror of 17 frozen public validator/type files is compiled
  within @wsgs/contracts. sync-world-analysis-runtime.mjs verifies each input
  against the frozen lock and checks output drift. Public contract bytes are
  unchanged. A typed facade exposes stable validator/hash signatures.
- JS source is explicitly included for build emission. Do not copy the public
  validator.d.mts beside it: TypeScript treats that declaration as a shadow and
  omits the actual JS module. The facade supplies runtime package declarations.
- Actual built dist/index.js successfully imported and validated the full
  METRIC_RANKING + ACTION_TARGET_CANDIDATE artificial contract example.
- Three focused tests PASS and whole-workspace npm run build PASS. Actual logs,
  exit codes and tested commit are in runtime-contract-tests.* and
  runtime-contract-build.*. These do not establish W02 normalization or L1 HTTP.

Next implementation: a thin mapper in historical-trace-consumer, revalidating
AnalysisProviderContracts.validateEnvelope before mapping the complete validated
analysisEvidence, not the already-cropped internal findings/safePayload. Reuse
the validated historical foundation and actual referenceProducts for source
lookup. Preserve scope/gaps/paused periods and network/measurement semantics.
Then implement closure-preserving display trimming and five golden families,
before marking WA-019 through WA-027 complete.

Important inspected source facts:

- Advanced analysisEvidence retains complete validated envelopes. validateEnvelope
  checks operation/schema/provider/compute/receipt/output hashes and optionally
  expected request input. Use the existing executor's intent/request checks;
  do not introduce direct Provider HTTP or local analysis algorithms.
- Provider metric statistics use minimum/maximum/median, and MEDIAN is the actual
  ranking basis. Representative sample values are not ranking scores.
- Provider event extents use eventTimeEstimate/eventTimeWindow or startTime/
  endTime/durationSeconds; public fields are estimatedAt/timeWindow or period.
- Provider RoadVisit identity combines sequenceNo/visitNo; road features and
  junction nodes are opaque network identities, not public ReferenceProducts.
- Some inherited artificial GSAP fixtures use non-public reference-key IDs
  (e.g. wrf_metric_fixture_trajectory). Golden projections must explicitly build
  controlled schema-valid fixture authority and recompute envelope integrity,
  never pretend those strings are deployed authoritative RP keys.

No new API profile selection, persistence/recovery path, HTTP listener or live
service has been enabled. No PR, push, deployment or DEV_READY claim yet.
