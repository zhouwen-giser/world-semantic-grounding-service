# W05 Completion Report

## Scope completed

Implemented a fixed-surface GOWM Gateway HTTP client for capability catalog, direct operation, World Query, async job polling, cancellation, and receipt retrieval.

## Source state

Only one deployment-provided Gateway base URL and credential supplier are configurable. IDs are validated and inserted only into frozen path templates; callers cannot submit arbitrary URLs or operation paths.

## Upstream contract state

The client consumes operation ID/version, provider, maturity, schema hashes, and ports from `required-operation-lock.json`. Missing/drifted required data fails readiness; optional absence becomes a non-blocking availability result. Because the frozen live catalog schema does not declare `providerId`, absence is explicitly a required mismatch rather than inferred success.

## Code/contracts/migrations

- Capability catalog validation with exact locks and optional degradation.
- Direct execution refuses request/lock version or schema hash mismatch.
- Fixed Gateway routes for catalog, operation, query, poll, cancel, job, and receipt.
- Deployment credential, `traceparent`, effective deadline, external `AbortSignal`, bounded request/response sizes.
- Retry only for 429/502/503 with bounded Retry-After/backoff; 400/403/409 are not retried.
- Independent circuit breaker with cooldown probe and recovery.

## Tests actually run

| command | result | evidence |
|---|---|---|
| `npm test -- packages/gowm-gateway-client/src/client.test.ts` | PASS | 12/12 contract/fault tests |
| `npm run check` | PASS | 13 local tests plus deferred DB tests before final W05 additions |
| `gh pr checks 1` | PASS | both hosted `verify` jobs passed after W04 push |

## Acceptance cases

- PASS: AC-G003, AC-G004, AC-G009..AC-G015.
- NOT_RUN: AC-G001, AC-G002, AC-G005..AC-G008, AC-G016 require the real locked Gateway in W16. Mock transport exercises behavior but is not counted as real-Gateway evidence.

## Authority and security review

Recursive request inspection rejects data scope, actor, permissions, authorization, or scope claims in bodies. Credentials and trace context remain headers. Error messages expose typed local codes/status only, not upstream response bodies.

## Failed attempts

The locked catalog's lack of provider identity was identified during contract inspection. The implementation fails closed with `PROVIDER_ID_UNAVAILABLE`; it does not weaken provider verification.

## Commit/push/PR

Recorded in the W05 semantic commit and Draft PR #1 update.

## Blockers

Real Gateway/provider/catalog evidence remains deferred to W16.

## Next phase

W06 deterministic parser and exact UTF-16 span verification.

