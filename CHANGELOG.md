# Changelog

## 0.2.0 candidate - 2026-08-27

- Locked the internal southbound integration to the exact GOWM+ 0.6.3 consumer artifact while retaining the frozen `sacs-wsgs-grounding/1.0` northbound response constants.
- Added signed delegation, trusted capability snapshots, a staged PostgreSQL worker pipeline, semantic requirement planning, capability matching, typed query compilation, and provider-neutral GOWM execution evidence handling.
- Added one `wsgs:0.2.0` image for separate non-root, read-only API and worker processes, plus a pinned PostgreSQL 17.10 service and a fail-closed migration/assertion job.
- Repeated real semantic-model checks passed. The current real GOWM+ result is 7 PASS / 2 BLOCKED; its passing observations are diagnostic-only after a semantic-lock canonicalization mismatch, and direct-operation `202` is unsupported.

This candidate is blocked. No stable-complete or production-ready marker is valid, and no release, tag, deploy, or merge has been performed.

## 0.1.0 - 2026-08-25

- Froze the SACS to WSGS grounding contract and exact GOWM 0.4.0 capability locks.
- Added durable PostgreSQL jobs, idempotency, leases, cancellation, replay, retention, and scope isolation.
- Added deterministic parsing, strict OpenAI-compatible semantic parsing, semantic frame/graph construction, reference grounding, typed query compilation, evidence normalization, operational products, and bounded prior context.
- Added authenticated sync/async/poll/cancel/capabilities routes plus security, rate, Unicode, cursor, queue, and graceful-shutdown controls.
- Added a pinned, non-root, read-only compatible container and qualification reports.

Candidate status is blocked: real semantic-model and GOWM Gateway/provider E2E were not runnable in the available environment. No release, tag, deploy, or merge has been performed.
