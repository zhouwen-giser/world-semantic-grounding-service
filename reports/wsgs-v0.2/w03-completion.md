# W03 Completion Report

## Phase

W03 — Delegated Identity. Decision: `BLOCKED`.

## Source state

The internal identity/delegation implementation is present in the uncommitted candidate working tree.

## Scope completed

Service principal, actor, data scopes, dataset scopes, permissions, and authorization-context hash are separated. RS256 delegation binds request, actor, narrowed scopes, operation allowlist, depth, and bounded lifetime.

## Contracts/migrations

Claims validate against the locked GOWM delegated-identity schema. Tokens are not database fields; only hashes cross durable evidence boundaries.

## Tests actually run

| command/gate | result | evidence |
|---|---|---|
| current full no-DB Vitest run | delegation and API identity tests PASS | `packages/delegated-identity/src/delegation.test.ts`, `services/grounding-api/src/server.test.ts` |
| real GOWM gate | positive signed delegation passes trusted calls | `reports/wsgs-v0.2/real-gowm-gate.json` |

## Acceptance cases

See `w03-acceptance.json`: 16 PASS, 1 BLOCKED, and 8 NOT_RUN.

## Security/authority review

Scope expansion, excessive TTL, unknown operation, wrong service subject, body authority, and signing-key import failures are rejected. No raw SACS bearer is forwarded.

## Failed attempts retained

No real negative verifier matrix currently demonstrates forged signature, wrong issuer/audience, expired/early token, request/depth mismatch, or equivalent re-sign replay.

## Commit/push/PR

No commit or push was performed by this reporting pass.

## Blockers

Positive DIRECT_OPERATION and WORLD_QUERY delegation now pass in the trusted signed Sample World gate. The real negative verifier matrix remains NOT_RUN.

## Next phase

Run the remaining live negative delegation matrix without weakening the now-passing positive boundary.
