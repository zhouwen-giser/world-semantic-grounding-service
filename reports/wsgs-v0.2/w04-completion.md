# W04 Completion Report

## Phase

W04 — Production Backend and Worker. Decision: `BLOCKED`.

## Source state

Backend, pipeline, PostgreSQL stores, worker, and production stage module exist in the candidate working tree; no final commit identifies this state yet.

## Scope completed

The runtime defines fourteen ordered stages, encrypted durable requests/checkpoints, generation fences, lease heartbeat/reclaim, cancellation, idempotency, bounded retry, result-schema settlement, and operation-specific stopping points.

## Contracts/migrations

Pipeline event, internal authority, and frozen result schemas are enforced. Migration 002 supplies job fences, immutable locks, checkpoints, execution and append-only event surfaces.

## Tests actually run

| command/gate | result | evidence |
|---|---|---|
| current full no-DB Vitest run | pipeline/worker component tests PASS; PostgreSQL files SKIP without DB variables | `reports/wsgs-v0.2/verification-summary.json` |
| focused worker tests | component PASS | `services/grounding-worker/src/pipeline-policy.test.ts`, `services/grounding-worker/src/result-schema.test.ts`, `services/grounding-worker/src/worker.test.ts` |
| isolated PostgreSQL suites | recorded separately; not a real external chain | `services/grounding-worker/src/postgres.integration.test.ts`, `reports/wsgs-v0.2/verification-summary.json` |

## Acceptance cases

See `w04-acceptance.json`: 29 PASS, 3 BLOCKED, and 2 NOT_RUN.

## Security/authority review

Source and checkpoint bytes are encrypted; late generations cannot settle; cancellation remains terminal; result bytes must validate before settlement.

## Failed attempts retained

Injected stage executors and readiness probes prove adapters, not the production Model/GOWM chain. They are not counted as real-e2e.

## Commit/push/PR

No commit or push was performed by this reporting pass.

## Blockers

No trusted API → queue → worker → real model/GOWM → persisted result → GET execution has completed. Actual API and PostgreSQL process restart cases are also unproven.

## Next phase

Repair the production compile/execution wiring, restore trusted GOWM readiness, and run a full multi-process request.
