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
| real GOWM | 8 trusted PASS / 2 BLOCKED | `reports/wsgs-v0.2/real-gowm-gate.json` |
| Sample World public handoff | PASS for 12-file intake, 122 capabilities/profiles, matching revisions/hashes, and fail-closed unauthenticated probes | `reports/wsgs-v0.2/real-gowm-sample-public-handoff.json` |

The earlier semantic canonicalization blocker is resolved for the explicit Sample World operational lock. Signed availability/execution now passes. Authenticated direct operations return HTTP `200` under `SYNC`, while the validation locks still lack `PINNED`.

## Acceptance cases

See `w13-acceptance.json`: 3 PASS and 22 BLOCKED. Model success alone is not a complete multi-process business E2E.

## Security/authority review

Scoped fixture checks excluded foreign data; prompt injection could not choose provider/operation/tool; private key and bearer values are absent from reports.

## Failed attempts retained

Earlier model timeout/schema failures and exact-source semantic-lock mismatch remain historical bounded evidence. The new operational lock is separately hash-pinned; no bundled hash was rewritten and no unauthenticated result was relabeled signed E2E.

## Commit/push/PR

No commit or push was performed by this reporting pass. The PR remains Draft.

## Blockers

No trusted API/worker multi-process run, restart matrix, large-evidence run, full stable-recipe catalog, or performance p50/p95 exists.

## Next phase

Run the real multi-process WSGS production chain and retain direct-202/PINNED blocks until upstream protocol capabilities change.
