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

The discovery suite adds a second real local HTTP Gateway listener. Northbound
HS256 service tokens are authenticated by the actual API, and the Gateway
verifies RS256 delegation from the actual worker discovery function. Real pinned
history and GSAP descriptors are combined with the baseline public catalog in a
test-only hash-locked deployment. It covers caller changes, permission omission,
T2 unavailability, metadata failure and unauthenticated rejection. Model readiness
is controlled false; admission throws if reached. No business operation executes.

The business suite traverses the actual pipeline and calls reference validation,
task retrieval, execution intervals and trajectory over signed local Gateway HTTP.
An advanced case then calls trajectory.map-match using the actual compiler and
executor. Historical outputs are validated against the fixed upstream schema
closure; GSAP outputs are controlled projections of its pinned fixture with
consistent subject/trajectory references, sample counts, times and gaps. Public
results retain interval/trajectory reference closure, off-network segments and
incomplete suffix semantics, and GET equals the saved result. Memory storage is
still controlled; none of these fixtures are live collected observations.

CROSS consumes the complete preceding map-match value through actual signed
HTTP and retains an unconfirmed LAST when its source suffix is incomplete. A
rehash-valid T3 response bound to an unrelated T2 result is rejected; T2 HTTP 503
does not invoke T3 and preserves the independent historical finding. Transport
failure and contract mismatch use distinct public gaps without raw server errors.

The complete LAST case is a separate closed execution window spanning four
fully observed points from the first sequence, two road visits and one junction
transition. Its history, map source counts, association boundaries, event source
hash, and absence of blockers agree. It is not the incomplete fixture with only
its confirmation flag flipped. Both complete and incomplete public selections
are checked. After a T2 failure the same service also handles new ordinary
reference grounding and independent history requests without calling T2/T3.

T4 Top-K uses a separate internally consistent controlled historical window and
the pinned metric fixture. The Gateway checks the compiled metric selector,
H3 resolution, topK and explicit series identity. Public values retain the actual
visited position, not the H3 cell center, and distinguish median ranking from
the representative measurement value.

The default Vitest pool is capped at four workers so simultaneous schema
compilation and local service initialization do not starve existing short
regression tests. Existing test deadlines and all assertions remain in force;
the Vitest CLI can override the worker count for a differently sized runner.

The business suite also runs two-round rank-to-action and three-round ambiguous
series-to-requery-to-rank-to-action requests. The test store supports only the
actual scope-filtered prior-result join, returning bytes from the preceding HTTP
settlement. The production authority loader decrypts that job's real AES
checkpoint. Series selection repeats T4, not history; rank selection restores
the prior evidence without another T4 query. Every result is validated, stored
and read by GET. Unknown candidate, incorrect prior hash and expired source each
produce the precise selection gap without any Gateway call. Action candidates
retain all three downstream requirements and executionAuthorized=false.

Every structured follow-up is replayed with its original idempotency key and
returns the same saved result. Changing the selected candidate or requested
metric with that key returns 409 without another job or upstream operation.
Controlled analysis responses honor the compiled zero-preview limits while
retaining the original source counts and statistics.

The required-row evidence audit and broader recovery/compatibility review remain
separate from these HTTP cases. Do not treat this suite alone as the complete
W06 gate or production readiness.
