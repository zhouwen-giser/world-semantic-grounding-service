# W15 Completion Report

## Scope completed

Implemented bounded Unicode/input controls, principal-and-scope rate budgets, signed scope-bound cursors, explicit logger/error redaction, bounded worker intake, graceful drain/abort behavior, and exercised durable restart, cross-scope, retention, lease, idempotency, and cancellation-race behavior against PostgreSQL 17.10.

## Security and resilience behavior

- Trusted identity and scope never come from the request body; missing identity and wrong JWT audience fail before backend dispatch.
- C0 control characters, unpaired UTF-16 surrogates, and combining-mark abuse fail before model/Gateway work.
- Request bytes are bounded by Fastify before handler/backend execution.
- Fixed-window budgets are keyed by principal plus data scope, with a bound on tracked keys.
- Cursor contents are HMAC-signed, TTL-bound, size-limited, and unreadable across scopes.
- URL, SQL, and operation-looking source text remains inert data; no arbitrary network, database, provider, or operation dispatch surface exists.
- Logs redact authorization, bodies, response bodies, internal error messages, and stacks; public errors expose a fixed typed envelope.
- The work queue bounds waiting work and concurrency, stops intake on shutdown, drains within grace, or propagates AbortSignal after grace.
- PostgreSQL makes cancellation terminal, ignores late completion, reclaims expired leases, and preserves byte-identical replay after store reconstruction.

## Tests actually run

| command | result | evidence |
|---|---|---|
| API security + signed cursor + bounded queue | PASS | 17/17 focused tests |
| PostgreSQL 17.10 durable suite | PASS | 9/9 real DB tests |
| `npm run check` | PASS | contract locks, architecture, strict TypeScript, 107 tests passed; 9 DB tests conditionally skipped in the no-DB root invocation |

## Acceptance cases

- PASS: AC-S001..AC-S012 from authenticated API, inert-input, redaction, size, Unicode, scope, and rate-budget tests plus real DB scope isolation.
- PASS: AC-S013 from explicit model-outage degradation without keyword/fact fallback.
- PASS: AC-S014 from Gateway failure and failed-evidence paths that preserve failure/unknown states without fabrication.
- PASS: AC-S015 from bounded 503 retry, circuit opening, cooldown recovery, fixed idempotent routes, and abort propagation.
- PASS: AC-S016 from real PostgreSQL store reconstruction, byte-identical replay, lease reclaim, and persisted results.
- PASS: AC-S017, AC-S018 from bounded queue and graceful drain/abort tests.

These fault/recovery cases do not replace W16 real GOWM/provider/model E2E.

## Failed attempts

The first W15 PostgreSQL rerun used an incorrect remembered test username/password and failed authentication before any tests ran. `docker inspect` showed the isolated container's actual `postgres` / `wsgs_test` credentials; the unchanged suite then passed 9/9 and the container was stopped.

## Commit/push/PR

Recorded in the W15 semantic commit and Draft PR #1 update.

## Blockers

No `MODEL_*` or real GOWM Gateway endpoint/credential is configured. W16 real natural-language and world-data acceptance remains blocked on those external services.

## Next phase

W16 executes real PostgreSQL, Gateway/provider, semantic-model, and northbound E2E acceptance where the environment is available and records all unavailable gates truthfully.
