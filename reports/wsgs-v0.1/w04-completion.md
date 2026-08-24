# W04 Completion Report

## Scope completed

Implemented the PostgreSQL `wsgs` schema and durable request/job/idempotency store with atomic replay/conflict handling, worker lease/heartbeat/reclaim, persistent cancellation, terminal monotonicity, scope-filtered reads, raw-source retention, and byte-identical result replay.

## Source state

All persistence is confined to the WSGS database schema. The application receives already encrypted source bytes and rejects raw `originalText`, conversation history, authorization, or token fields in persisted metadata.

## Upstream contract state

No GOWM database is accessed. World queries/results will arrive only through the future Gateway client; W04 stores WSGS-owned job and product state.

## Code/contracts/migrations

- Migration `001_wsgs_core.sql`: 11 schema/migration tables including the 10 required domain tables.
- Assertion `001_wsgs_core.sql`: required table and claim-index checks.
- `PostgresJobStore`: advisory-lock idempotency, scoped CRUD, `FOR UPDATE SKIP LOCKED`, heartbeat/reclaim, cancel, completion, retention.
- Database trigger rejects terminal-state regression and late completion after persistent cancellation.
- `CancellationRegistry` propagates an AbortSignal to in-process work.

## Tests actually run

| command | result | evidence |
|---|---|---|
| first real PostgreSQL integration run | FAIL | NUL in advisory-lock text key rejected by PostgreSQL UTF-8 protocol |
| corrected real PostgreSQL integration test | PASS | 7/7 then expanded full suite |
| `TEST_DATABASE_URL=... npm run check` | PASS | 3 files, 11/11 tests, contracts/typecheck/boundaries pass |
| database evidence query | PASS | PostgreSQL 17.10, 11 `wsgs` tables, `001_wsgs_core.sql` applied |

Container image: `postgres:17.10-alpine3.23`, image ID `sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4`.

## Acceptance cases

- PASS: AC-J001, AC-J003..AC-J008, AC-J013..AC-J016.
- NOT_RUN: AC-J002 (no predecessor schema exists yet); AC-J009..AC-J012 require the actual model/Gateway worker integrations in W05/W07/W15.

## Authority and security review

Data scope participates in idempotency identity and every job/result read. Original text is isolated as ciphertext with an expiry, and metadata rejects sensitive source/auth fields. Job logs are not emitted here. No upstream database or provider is referenced.

## Failed attempts

The NUL-separated advisory key was replaced with a deterministic SHA-256-derived signed 64-bit key. The failing run is retained and was not counted as acceptance.

## Commit/push/PR

Recorded in the W04 semantic commit and Draft PR #1 update.

## Blockers

Model- and Gateway-specific abort/cancel race cases remain deferred to their implementation phases.

## Next phase

W05 capability-locked GOWM Gateway HTTP client.

