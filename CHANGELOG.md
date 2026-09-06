# Changelog

## v0.2.3 advanced-history work item - unreleased

- Intake exact GSAP T2/T3/T4 provider schemas, hashes, semantic profiles, and type-only models.
- Add bounded, explicitly authorized historical road, event, cross-event, and metric query DAGs through the existing signed GOWM Gateway.
- Preserve upstream provenance and completeness in CAPABILITY_RESULT evidence; enable hash-verified, scope-bound historical follow-ups and non-executable past-location candidates.
- Add opt-in configuration, deterministic metric catalog, offline provider fixtures, contract/consumer/runtime tests, and explicit live-smoke qualification.
- Development-only work item; release surfaces remain 0.2.1. No merge, tag, release, deployment, strict-replay, current-recommendation, or production qualification.

## 0.2.1 candidate - 2026-08-30

- Unified mutable WSGS release surfaces at `0.2.1`, including `VERSION`, root and private workspace manifests, the workspace lockfile, the OCI image label, and the default `wsgs:0.2.1` image tag.
- Preserved the byte-locked `sacs-wsgs-grounding/1.0` contract and its hash while introducing the additive `sacs-wsgs-grounding/1.1` geospatial result-extension profile; the public wire envelope remains `schemaVersion: "1.0"`.
- Kept historical reports, vendored upstream package versions, and prior release records immutable. v0.2.1 remains a development candidate with `productionQualified=false` until its authoritative handoff and real consumer/runtime gates pass.

## 0.2.0 candidate - 2026-08-27

- Locked the internal southbound integration to the exact GOWM+ 0.6.3 consumer artifact while retaining the frozen `sacs-wsgs-grounding/1.0` northbound response constants.
- Added signed delegation, trusted capability snapshots, a staged PostgreSQL worker pipeline, semantic requirement planning, capability matching, typed query compilation, and provider-neutral GOWM execution evidence handling.
- Added one `wsgs:0.2.0` image for separate non-root, read-only API and worker processes, plus a pinned PostgreSQL 17.10 service and a fail-closed migration/assertion job.
- Repeated real semantic-model checks passed. A pinned GOWM+ Sample World gate verifies public discovery plus signed availability and trusted execution, including World Query `202`/poll, cancellation, and receipt retrieval. WSGS canonical hashing now uses code-point key ordering consistently. Direct-operation `202` and exact historical `PINNED` validation remain deferred production gaps.
- Added a separate 63-case Development Ready acceptance profile while preserving the historical 279-case ledger and 14 production-deferred items.
- Completed the real public API to PostgreSQL queue to worker to semantic model to WSGS planner/compiler to signed GOWM to persisted-result pipeline, with R1-R6 evidence and a controlled worker-restart recovery case.
- Corrected stable nearby compilation to compose the live `world.get-current-state.positionCoordinates` port with `spatial.find-nearby.location`; area geometry composition remains unchanged.
- Added the machine-valid SACS development handoff and Development Ready reports with `productionQualified=false`.

This candidate is Development Ready and remains Production Not Qualified. No production-ready marker is valid, and no release, tag, deploy, or merge has been performed.

## 0.1.0 - 2026-08-25

- Froze the SACS to WSGS grounding contract and exact GOWM 0.4.0 capability locks.
- Added durable PostgreSQL jobs, idempotency, leases, cancellation, replay, retention, and scope isolation.
- Added deterministic parsing, strict OpenAI-compatible semantic parsing, semantic frame/graph construction, reference grounding, typed query compilation, evidence normalization, operational products, and bounded prior context.
- Added authenticated sync/async/poll/cancel/capabilities routes plus security, rate, Unicode, cursor, queue, and graceful-shutdown controls.
- Added a pinned, non-root, read-only compatible container and qualification reports.

Candidate status is blocked: real semantic-model and GOWM Gateway/provider E2E were not runnable in the available environment. No release, tag, deploy, or merge has been performed.
