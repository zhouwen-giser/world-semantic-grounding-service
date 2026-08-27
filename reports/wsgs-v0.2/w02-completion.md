# W02 Completion Report

## Phase

W02 — Gateway Client v2. Decision: `BLOCKED`.

## Source state

Candidate branch `codex/wsgs-v0.2-gowm-0.6.3-integration`; final candidate SHA is not yet formed.

## Scope completed

The client exposes capability/semantic/availability discovery, locked direct execution, world-query submit/poll/cancel, bounded receipt fetch, deadlines, retry/circuit policy, schema validation, and body-authority rejection without provider routing.

## Contracts/migrations

All transport validation consumes the exact GOWM 0.6.3 bundle and lock v2. No GOWM application schema, URL, or database authority was added.

## Tests actually run

| command/gate | result | evidence |
|---|---|---|
| current full no-DB Vitest run | PASS for component tests | `reports/wsgs-v0.2/verification-summary.json`, `packages/gowm-gateway-client/src/client.test.ts` |
| real GOWM gate | 7 diagnostic PASS / 2 BLOCKED overall | `reports/wsgs-v0.2/real-gowm-gate.json` |
| Sample World public handoff gate | PASS for exact handoff, capabilities, semantics, and fail-closed unauthenticated probes | `reports/wsgs-v0.2/real-gowm-sample-public-handoff.json` |

## Acceptance cases

See `w02-acceptance.json`: 19 PASS and 6 BLOCKED. Public capabilities and semantics are now independently trusted against the pinned operational lock; signed availability and execution remain blocked.

## Security/authority review

The client rejects authority in request bodies, bounds requests/responses and overall deadlines, and never selects provider topology.

## Failed attempts retained

The earlier exact-source lock mismatch remains historical evidence. The Sample World operational-candidate lock is selected only by explicit file path plus exact SHA-256 and does not rewrite the bundled source lock.

## Commit/push/PR

No commit or push was performed by this reporting pass. Draft PR #2 must remain Draft.

## Blockers

Signed availability and execution were not run because secure credential handoff was not authorized. The public descriptor is `SYNC`; an authenticated direct-operation `202` lifecycle is unproven.

## Next phase

Authorize a secure credential handoff, then rerun signed availability, direct/query/job/cancel/receipt, and exact `202` lifecycle checks against the pinned Sample World lock.
