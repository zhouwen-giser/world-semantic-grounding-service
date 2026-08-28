# W02 Completion Report

## Phase

W02 — Gateway Client v2. Decision: `PASS`.

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
| real GOWM gate | 8 trusted PASS / 2 BLOCKED overall | `reports/wsgs-v0.2/real-gowm-gate.json` |
| Sample World public handoff gate | PASS for exact handoff, capabilities, semantics, and fail-closed unauthenticated probes | `reports/wsgs-v0.2/real-gowm-sample-public-handoff.json` |

## Acceptance cases

See `w02-acceptance.json`: 25 PASS and 0 BLOCKED. Public and signed contract/availability authority plus direct/query/job/cancel/receipt transport paths are trusted against the pinned operational lock.

## Security/authority review

The client rejects authority in request bodies, bounds requests/responses and overall deadlines, and never selects provider topology.

## Failed attempts retained

The earlier exact-source lock mismatch remains historical evidence. The Sample World operational-candidate lock is selected only by explicit file path plus exact SHA-256 and does not rewrite the bundled source lock.

## Commit/push/PR

No commit or push was performed by this reporting pass. Draft PR #2 must remain Draft.

## Blockers

No W02-owned Gateway Client case remains blocked. The cross-phase direct-operation asynchronous `202` requirement remains blocked because authenticated direct execution returns HTTP `200` under a `SYNC` descriptor.

## Next phase

Retain the direct-operation `202` gap in W10/W13 evidence and continue the full production-chain qualification without weakening it to World Query async.
