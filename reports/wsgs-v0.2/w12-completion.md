# W12 Completion Report

## Phase

W12 — Persistence, API, Readiness, Security, and Recovery. Decision: `BLOCKED`.

## Source state

Migration 002, production API/store wiring, worker service, deployment image, Compose topology, and operational documentation are present in the working tree.

## Scope completed

Database authority fields, pipeline checkpoints/events, encrypted source/checkpoint storage, result-schema transactional settlement, API authentication/rate/body/redaction controls, separate API/worker commands, migration job, and internal PostgreSQL topology are implemented.

## Contracts/migrations

Migration 001 remains frozen. Fresh 001+002 install and assertions succeeded in an isolated Compose smoke. The runner rejects checksum drift and exits before services start on migration failure.

## Tests actually run

| command/gate | result | evidence |
|---|---|---|
| current contracts/architecture/typecheck/no-DB tests | PASS with real-DB files skipped | `reports/wsgs-v0.2/verification-summary.json` |
| isolated current-schema PostgreSQL suites | 3 files, 18 tests PASS, 0 skipped | `packages/runtime/src/job-store.integration.test.ts`, `services/grounding-api/src/production.integration.test.ts`, `services/grounding-worker/src/postgres.integration.test.ts` |
| isolated fresh 001-to-002 PostgreSQL suite | 1 file, 2 tests PASS, including failed-002 rollback | `packages/runtime/src/migration-002.integration.test.ts` |
| production readiness gate with real dependencies | PASS as a negative gate: HTTP 503, reason `SEMANTIC_CATALOG_DRIFT` | `validation/scripts/real-production-readiness-gate.ts`, `reports/wsgs-v0.2/verification-summary.json` |
| `docker build` and image entrypoint/UID inspection | PASS | `reports/wsgs-v0.2/verification-summary.json` |
| isolated Compose PostgreSQL → migration → assertions smoke | PASS; disposable volume removed | `reports/wsgs-v0.2/verification-summary.json` |

## Acceptance cases

See `w12-acceptance.json`: 22 PASS, 4 BLOCKED, and 5 NOT_RUN.

## Security/authority review

Only API publishes a loopback port. WSGS services are UID/GID 10001 and read-only. Secrets remain external. Architecture checks exclude GOWM DB and SDAR/A2A dependencies.

## Failed attempts retained

The first reused database correctly rejected changed migration-002 bytes by checksum. It was not overwritten. A separate fresh upgrade database then proved that failed migration 002 rolls back. Current evidence still does not claim every readiness fault or execution-record path passed.

## Commit/push/PR

Implementation commit `72b911ed9fc453d7c1d736ab551957e4ff4b8850` and deployment commit `9cf1f897cfc400c61c434fe1b34b31ab7f59c99b` exist locally. No commit or push was performed by this reporting calibration.

## Blockers

The historical production readiness path is proven to fail closed with `503` under the old bundled-lock drift. Signed Sample World Gateway authority and execution now pass independently, but a trusted API/worker/model/GOWM/database business chain plus process restart and live cancel/late-result recovery remain unproven.

## Next phase

Complete the remaining write/fault and restart runs, repair trusted GOWM readiness, then exercise the full long-running production chain.
