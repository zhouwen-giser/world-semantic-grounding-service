# World Analysis HTTP Development Verification

Run `npm run test:world-analysis:http`. It builds workspace packages before
running the real HTTP tests, so package exports cannot silently use stale
compiled normalizer code.

## Actual Path

The test binds Fastify to `127.0.0.1` on an OS-assigned port and sends real
`fetch` requests. Requests traverse normal API schema validation and negotiation,
`ProductionGroundingBackend`, the actual production stage factory,
`GroundingPipeline`, `GroundingWorker`, public analysis normalization and the
worker result validator. The test store seals requests and checkpoints with
the actual AES-GCM codec and returns saved bytes on GET without re-normalizing.
Every listener is closed and every worker heartbeat is stopped after its case.

## Controlled Boundaries

`tests/world-analysis-http-support.ts` is explicitly test-only memory storage.
It implements admission, lease fencing, checkpoint storage and settlement; a
strict SQL adapter handles the production stages' bookkeeping writes. Unknown
SQL fails the test. This does not prove PostgreSQL crash durability or database
transaction semantics. The real production backend, pipeline, stage handlers,
normalizer and result validator are not replaced by prebuilt results.

The public Gateway catalog fixture was extracted from the already locked GOWM
commit `c49bf415fdb4cbe19a09f341c34b6dd825e3ca14`. Its complete semantic hash and
every frozen southbound operation fingerprint were checked at intake. The
catalog contains 122 descriptors, including operations outside the selected
production lock. Tests require no sibling checkout; the optional intake script
only regenerates public metadata and never changes runtime contract locks.

The initial scenarios use the existing MODEL_OPTIONAL behavior with no model
configured. They do not claim model accuracy. They do not issue Gateway business
requests or call live providers; full upstream-operation HTTP scenarios remain
required follow-on work. No database URL or deployment credential is used.

## Current Coverage

- Synchronous 200 and asynchronous 202 followed by actual worker and terminal GET.
- Stored result hashing and no GET-time reprojection.
- Profile-bound idempotency, payload conflict and cross-profile GET rejection.
- Cancellation before claim and expired deadline before execution.
- All 14 stages for an advanced-history request under default-disabled flags,
  with an explicit blocking CAPABILITY_UNAVAILABLE public gap.
- Compile-only advanced analysis returns the public result at WORLD_QUERY_COMPILE
  without entering GOWM_EXECUTE, including the default-disabled typed gap.
- Unchanged 1.0 and 1.1 public results through the same production path.

Nonempty historical trace, roads, CROSS complete/incomplete, Top-K, structured
series/rank/action rounds and provider-missing isolation still need HTTP cases.
Do not treat this initial suite as the complete W06 gate or production readiness.
