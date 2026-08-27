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

## Acceptance cases

See `w02-acceptance.json`: 17 PASS and 8 BLOCKED. No diagnostic live result is upgraded to trusted real-e2e.

## Security/authority review

The client rejects authority in request bodies, bounds requests/responses and overall deadlines, and never selects provider topology.

## Failed attempts retained

The live semantic catalog recomputes to a different hash under runtime canonicalization. The published lock value is not weakened or rewritten.

## Commit/push/PR

No commit or push was performed by this reporting pass. Draft PR #2 must remain Draft.

## Blockers

Trusted catalog readiness is closed. Direct-operation asynchronous `202` is not supported by locked GOWM 0.6.3.

## Next phase

Correct the upstream semantic authority artifact or canonicalization contract, then rerun the live Gateway matrix.
