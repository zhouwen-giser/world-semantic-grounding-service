# W14 Completion Report

## Scope completed

Implemented the frozen northbound HTTP surface with STATIC_TRUSTED and JWT_SERVICE identities, strict request and response validation, source-hash and idempotency enforcement, synchronous and asynchronous creation, scoped polling and cancellation, capabilities, readiness/liveness, and low-cardinality metrics.

## API behavior

- Protected routes derive principal, actor, scope, and permissions only from trusted deployment or verified JWT context.
- POST validates the exact frozen request schema, rejects recursive authority-field injection, and verifies the original-text SHA-256 before invoking the backend.
- `Prefer: respond-async` selects the 202 job envelope; the synchronous path emits the 200 result envelope.
- Poll and cancel pass the authenticated identity to the backend and expose missing/cross-scope records only as the same opaque 404.
- Every successful public payload and every public error envelope is validated against the frozen schema before emission.
- Required readiness failures return 503; optional availability is represented only in the frozen capabilities document.

## Tests actually run

| command | result | evidence |
|---|---|---|
| grounding API suite | PASS | 8/8 route, schema, auth, identity, poll/cancel, fail-closed response, and metrics tests |
| `npm run check` | PASS | contract locks, architecture, strict TypeScript, 98 tests passed; 9 real-DB tests skipped without `TEST_DATABASE_URL` |
| real API to worker/GOWM/model E2E | NOT_RUN | production backend composition and external services are W15/W16 work |

## Acceptance cases

- PASS: AC-C012, AC-C013, AC-C014.
- NOT_RUN: AC-S019..AC-S024. The injected backend proves API protocol behavior but is not real E2E evidence.

## Authority and security review

No public body can set identity, actor, permissions, or data scope. The API accepts no URL, SQL, operation ID, provider ID, or executable plan field. Public errors use a fixed redacted message. Metrics contain only fixed counter names and never user text, scope, ReferenceKey, or request/job IDs.

## Failed attempts

Fastify treated the literal colon in `:groundingId:cancel` as part of its parameter grammar. The implementation now uses a bounded wildcard route and validates the exact `:cancel` suffix and identifier before backend dispatch; the public URL remains exactly frozen.

## Commit/push/PR

Recorded in the W14 semantic commit and Draft PR #1 update.

## Blockers

Real sync/async/poll/cancel and required/optional capability behavior require the durable production backend and real W16 services.

## Next phase

W15 adds bounded input/rate enforcement, scoped durable backend composition, restart/cancel-race behavior, and graceful worker shutdown.
