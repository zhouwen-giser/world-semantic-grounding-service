# W13 Completion Report

## Phase

W13 — Real Model and GOWM E2E. Decision: `BLOCKED`.

## Source state

The real-gate scripts and disposable GOWM fixture/runtime were used without modifying the authoritative GOWM checkout.

## Scope completed

The real model independently passed four Chinese cases across three consecutive runs. The real GOWM gate exercised live contract endpoints, scoped business data, a world query, receipt fetch, and cancellation.

## Contracts/migrations

All live calls used the exact 0.6.3 consumer bundle and signed delegation. The gate did not bypass the Gateway or access a GOWM database from WSGS.

## Tests actually run

| gate | result | evidence |
|---|---|---|
| real semantic model | PASS, four cases × three runs | `reports/wsgs-v0.2/real-model-gate.json` |
| real GOWM | 7 diagnostic PASS / 2 BLOCKED | `reports/wsgs-v0.2/real-gowm-gate.json` |

The two GOWM blockers are the consumer semantic-lock canonicalization mismatch and lack of direct-operation `202`. The seven other observations remain diagnostic-only.

## Acceptance cases

See `w13-acceptance.json`: 3 PASS and 22 BLOCKED. Model success alone is not a complete multi-process business E2E.

## Security/authority review

Scoped fixture checks excluded foreign data; prompt injection could not choose provider/operation/tool; private key and bearer values are absent from reports.

## Failed attempts retained

Earlier model timeout/schema failures and the live semantic-lock mismatch remain in bounded evidence. No hash was rewritten and no diagnostic success was relabeled trusted.

## Commit/push/PR

No commit or push was performed by this reporting pass. The PR remains Draft.

## Blockers

No trusted API/worker multi-process run, restart matrix, large-evidence run, full stable-recipe catalog, or performance p50/p95 exists.

## Next phase

Resolve the upstream lock and operation-support gaps, repair production compiler inputs, then rerun the complete W13 matrix.
