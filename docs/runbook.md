# WSGS 0.2 Operations Runbook

The opt-in GSAP T2/T3/T4 consumer is documented in [advanced historical analysis](advanced-historical-analysis.md). It requires both history and advanced-history flags, exact deployed operation locks, and the existing signed Gateway authority. Its narrowly verified PREVIEW authorization does not require globally enabling arbitrary PREVIEW operations. Missing analysis providers remain optional for ordinary WSGS readiness.

The optional GOWM task-interval and historical-trajectory integration is documented in [historical trace consumption](historical-trace-consumption.md). It is disabled by default and requires both `WSGS_ALLOW_PREVIEW_CAPABILITIES=YES` and `WSGS_HISTORY_TRACE_ENABLED=YES`, plus the exact operation lock from the current GOWM deployment. Missing historical capabilities do not make stable WSGS readiness fail.

## Current qualification state

WSGS 0.2.0 is a blocked integration candidate, not a production release. Repeated real semantic-model runs passed. The signed Sample World operational-candidate gate reports **8 trusted PASS / 2 BLOCKED**: its exact lock, live contract/binding/semantic authority, five-operation signed availability, direct sync calls, World Query `202`/poll, cancellation, and receipt retrieval pass.

Its `reference.validate@1.0` and `result.validate@1.0` locks still expose `CONSISTENT_AT_START`, not `PINNED`. Authenticated direct execution returns HTTP `200` under a `SYNC` descriptor, so the required direct-operation asynchronous `202` lifecycle is absent even though World Query async succeeds. The service deliberately fails closed. `/health/live` can return `200` while `/health/ready` returns `503`; liveness proves only that the API process is running. Do not route production traffic or mark the candidate complete while these gates remain blocked.

The public `GET /v1/capabilities` response remains the frozen v0.1 contract and therefore still reports WSGS `0.1.0` and GOWM `0.4.0`. Those constants are compatibility metadata, not the candidate's internal GOWM+ 0.6.3 authority lock.

## Prerequisites and secret handling

- Docker Desktop with Compose v2.
- A reachable real OpenAI-compatible model endpoint.
- A reachable real GOWM+ 0.6.3 Gateway whose registered issuer, audience, service principal, public key, transport credential, data scopes, and dataset scopes match the WSGS configuration.
- A PKCS#8 RSA private key corresponding to the public key registered by GOWM+. Keep it outside the repository.

Copy `.env.example` to `.env`, replace every `REPLACE_*` value, and never commit `.env`, credentials, private keys, database dumps, or command output containing them. `WSGS_REQUEST_ENCRYPTION_KEY_BASE64` must decode to exactly 32 bytes. `WSGS_JWT_HS256_SECRET` must contain at least 32 UTF-8 bytes. URL-encode the PostgreSQL password embedded in `DATABASE_URL`.

The Compose file mounts the delegation private key at `/run/secrets/gowm-delegation-private-key.pem`. Set `GOWM_DELEGATION_PRIVATE_KEY_FILE_HOST` to its host path. The transport bearer in `GOWM_GATEWAY_TOKEN` and the signed delegation token serve separate purposes; both authority layers remain required.

## Local build and static verification

```powershell
npm ci
npm run contracts:check
npm run architecture:check
npm run typecheck
npm test
npm run build
```

The v0.2 ledger has explicit read and write commands. Do not use the write command to invent or upgrade evidence; its input evidence groups must already be complete and truthful.

```powershell
npm run acceptance:v0.2:check
# Maintainer-only regeneration from reviewed evidence groups:
npm run acceptance:v0.2:write
```

## Database migration

The production image contains the compiled migration runner. It applies ordered SQL files in one transaction, records a SHA-256 checksum for every version, and fails closed on checksum drift. `db:migrate:verify` also runs the SQL assertion suite.

```powershell
npm run build
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:PORT/DATABASE'
npm run db:migrate:verify
```

Never edit an applied migration. A checksum mismatch is an incident, not permission to rewrite the recorded checksum. Create a new forward migration or restore a database snapshot paired with the exact earlier image.

For a fresh Compose test without touching an existing volume, choose a new project name. Compose creates an isolated PostgreSQL volume, waits for PostgreSQL health, runs all migrations and assertions, and starts the API and worker only after the migration job exits successfully.

```powershell
Copy-Item .env.example .env
# Replace placeholders in .env and provide the external private-key file first.
docker compose --project-name wsgs-v02-smoke --env-file .env config
docker compose --project-name wsgs-v02-smoke --env-file .env up --detach --build
docker compose --project-name wsgs-v02-smoke --env-file .env ps --all
docker compose --project-name wsgs-v02-smoke --env-file .env logs wsgs-migrate
```

The expected migration container exit code is zero and its output marker is `WSGS_DATABASE_MIGRATION_PASS`. A non-zero exit prevents both WSGS processes from starting. Re-running the same immutable migrations is safe: existing versions are skipped only after their checksums match.

## Runtime topology and health

The same `wsgs:0.2.0` image runs three commands:

- `wsgs-migrate`: one-shot migration and database assertion job;
- `grounding-api`: northbound HTTP API;
- `grounding-worker`: durable pipeline lease consumer.

The two long-running WSGS containers run as UID/GID 10001, with read-only root filesystems, bounded temporary filesystems, an init process, no-new-privileges, and graceful `SIGTERM` handling. PostgreSQL 17.10 is digest-pinned and uses a named data volume. Only the API publishes a host port, bound to `127.0.0.1`; PostgreSQL and the worker are internal to the Compose network.

Check liveness and readiness separately:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health/live
$ready = Invoke-WebRequest http://127.0.0.1:8080/health/ready -SkipHttpErrorCheck
$ready.StatusCode
$ready.Content
```

Readiness requires PostgreSQL, the exact local consumer intake, live capability and semantic catalogs, signed operation availability, the configured model policy, and the trusted GOWM lock to agree. Treat any non-`200` readiness result as a traffic block. A Sample World handoff passing the public gate does not make readiness true because public discovery cannot replace signed availability or execution.

## Real qualification gates

The real gates are opt-in and perform external calls. Run them only with isolated scoped credentials and test data. Their scripts emit hashes and bounded metadata, not raw secrets.

Real model:

```powershell
$env:ALLOW_REAL_MODEL_GATE = 'YES'
$env:MODEL_BASE_URL = 'http://127.0.0.1:11434/v1'
$env:MODEL_API_KEY = '<local-or-real-model-credential>'
$env:MODEL_NAME = 'gemma3:latest'
$env:MODEL_OUTPUT_MODE = 'CHAT_COMPLETIONS_STRICT'
$env:MODEL_TIMEOUT_MS = '120000'
$env:MODEL_MAX_RETRIES = '1'
npm run gate:real:model
```

The enclosing `SEMANTIC_MODEL_PARSE` pipeline stage inherits `MODEL_TIMEOUT_MS` by default and is still clamped by the request deadline. Operators may set `WSGS_PIPELINE_ATTEMPT_TIMEOUT_MS` or a narrower per-stage variable such as `WSGS_PIPELINE_SEMANTIC_MODEL_PARSE_ATTEMPT_TIMEOUT_MS`; malformed values fail worker startup before a job is claimed.

Real GOWM+:

First validate a non-sensitive Sample World handoff and public discovery. This command sends no bearer or delegation header and requires unauthenticated availability to fail closed with HTTP `403` / `SCOPE_DENIED`:

```powershell
$env:GOWM_SAMPLE_HANDOFF_DIR = '<absolute-handoff-directory>'
$env:GOWM_BASE_URL = 'http://127.0.0.1:18063'
npm run gate:real:gowm:public-handoff
```

An operational-candidate lock never silently replaces the exact-source bundled lock. To select one for a host-side authenticated gate, set both its path and its exact byte hash. A missing value or byte mismatch fails before network trust is established:

```powershell
$env:ALLOW_REAL_GOWM_GATE = 'YES'
$env:GOWM_BASE_URL = 'http://127.0.0.1:18063'
$env:GOWM_SOUTHBOUND_LOCK_FILE = '<absolute-handoff-directory>\CONSUMER_CONTRACT_LOCK.json'
$env:GOWM_SOUTHBOUND_LOCK_SHA256 = 'sha256:<exact-lock-byte-hash>'
$env:GOWM_GATEWAY_CREDENTIAL = '<transport-credential>'
$env:GOWM_DELEGATION_PRIVATE_KEY_PATH = '<absolute-pkcs8-private-key-path>'
$env:GOWM_SERVICE_PRINCIPAL_ID = '<registered-principal>'
$env:GOWM_DELEGATION_ISSUER = '<registered-issuer>'
$env:GOWM_DELEGATION_AUDIENCE = '<registered-audience>'
$env:GOWM_DATA_SCOPE = '<isolated-data-scope>'
$env:GOWM_DATASET_SCOPE = '<isolated-dataset-scope>'
npm run gate:real:gowm
```

For Compose, set `GOWM_SOUTHBOUND_LOCK_HOST_FILE` to the verified non-sensitive host lock, set `GOWM_SOUTHBOUND_LOCK_FILE=/run/wsgs/gowm-southbound-operation-lock.json`, and set its exact `GOWM_SOUTHBOUND_LOCK_SHA256`. The API and worker receive the same read-only bind mount. Leave both lock-selection variables empty to keep using the immutable bundled source lock.

Do not infer credential file locations or copy credentials from another task. If secure credential handoff is not explicitly authorized, record `BLOCKED — secure credential handoff authorization required`. The real GOWM+ gate intentionally exits non-zero while required checks are blocked. Do not suppress that exit code. A world-query asynchronous lifecycle does not substitute for a missing direct-operation `202` behavior.

After setting the complete production environment used by the API and worker, exercise the actual HTTP readiness path:

```powershell
$env:ALLOW_REAL_PRODUCTION_READINESS_GATE = 'YES'
npm run gate:real:readiness
```

Until signed availability, model, PostgreSQL, and the selected exact lock all pass together, the safe production-readiness result remains HTTP `503`; a fail-closed negative-gate marker is not a readiness success marker.

The current-schema PostgreSQL suites may share one dedicated, freshly migrated test database when run serially. Never point them at production:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:PORT/ISOLATED_TEST_DATABASE'
npm test -- --no-file-parallelism --run packages/runtime/src/job-store.integration.test.ts services/grounding-api/src/production.integration.test.ts services/grounding-worker/src/postgres.integration.test.ts
```

The 001-to-002 upgrade and failed-002 rollback suite mutates its database through a legacy state. Give it a second, empty database through `TEST_UPGRADE_DATABASE_URL` and run it separately; do not put it in the current-schema command or run another suite against that database concurrently.

```powershell
$env:TEST_UPGRADE_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:PORT/FRESH_ISOLATED_UPGRADE_DATABASE'
npm test -- --run packages/runtime/src/migration-002.integration.test.ts
```

## Stop, rollback, and incident response

Gracefully stop intake and work before changing credentials, binaries, or database state:

```powershell
docker compose --project-name wsgs-v02-smoke --env-file .env stop grounding-api grounding-worker
docker compose --project-name wsgs-v02-smoke --env-file .env down
```

`down` preserves the named PostgreSQL volume. Removing volumes destroys database state and is appropriate only for an explicitly disposable test project after confirming its exact Compose project name.

- On migration failure, leave API and worker stopped. Preserve the failing checksum evidence and database snapshot.
- On model failure, timeout, schema violation, or prompt-authority violation, keep readiness closed; do not substitute deterministic parsing for a `MODEL_REQUIRED` request.
- On GOWM catalog, semantic lock, availability, delegation, scope, or snapshot drift, keep readiness closed and do not bypass the Gateway or read provider databases directly.
- On worker shutdown, durable jobs and append-only pipeline events remain authoritative in PostgreSQL. Expired leases may be reclaimed after the configured grace period; terminal and cancelled results must not regress.
- Rotate JWT, encryption, model, Gateway, and delegation credentials outside the image. Review logs before sharing them and never paste raw environment values into reports.

## Runtime defect fixes: configuration and source cleanup

Compose passes `WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON` to the API;
its default `[]` keeps the 1.2 contract disabled. `WSGS_PRIMARY_DATA_SCOPE`
selects one exact authorized scope for multi-scope identities. Empty or unset
preserves the single-scope behavior; whitespace and wildcard values are invalid.
Neither setting expands Gateway authority.

`WSGS_SOURCE_RETENTION_MS` is an API setting (default 3600000, supported range
1000–604800000). The worker reads `WSGS_SOURCE_CLEANUP_INTERVAL_MS` (default
60000, positive integer up to 2147483647) and `WSGS_SOURCE_CLEANUP_BATCH_SIZE`
(default 100, positive safe integer). Cleanup runs at startup and after each
interval, never overlaps itself, and uses job locks to coexist with other workers.
Only expired terminal jobs are cleaned. Active jobs keep their original deadline;
results and idempotency replay are retained. See [context retention](context-and-prior-grounding.md).

After updating environment values, recreate the affected API/worker containers.
Existing expired terminal data is processed in bounded batches without a schema
migration. Observe `source_cleanup` counts and `source_cleanup_failed` codes;
failures are retried on the next scan. Cleanup stops before the database pool closes.

Transient database/transaction errors in the worker loop back off from 500 ms to
30 seconds, resetting after success. Corrupt claimed input is fenced into a
`WORKER_CLAIM_INVALID` failure without stopping other work. Unknown runtime errors
stop admission and drain/abort active work before the pool closes. A missing COMMIT
response never causes a compensating FAILED write over a possibly committed result.
Runtime logs contain codes and task identifiers, not source text or credentials.
If the dedicated LISTEN connection is lost, `worker_cancellation_listener_lost`
reports the loss and lease heartbeats continue detecting persisted cancellations.
Push notifications resume after worker recreation; no restart matrix is claimed.

Malformed or empty JSON now returns 400 `INVALID_JSON_BODY`; unsupported media
returns 415 `UNSUPPORTED_MEDIA_TYPE`; oversized bodies retain 413
`REQUEST_TOO_LARGE`. These request errors are not retryable. Unknown internal
errors still return the redacted 500 protocol envelope.

These fixes do not qualify production readiness or close the production-deferred
restart, performance, security, HA or disaster-recovery matrices.

## Latest formal consumer and isolated instance

The current refresh/build/deploy workflow is documented in [latest-gowm-instance.md](latest-gowm-instance.md). Its instance acceptance is separate from the historical qualification gates above and does not change production eligibility.

### 历史查询的有效快照

历史执行区间通过 `HISTORICAL_EXECUTION_INTERVAL` World Query 查询；轨迹通过 `HISTORICAL_TRAJECTORY` 的区间→轨迹双节点计划查询。两者使用 `LATEST_AT_START` 且禁止降级，由 Gateway 捕获快照并发现依赖。任务发现、任务读取及 actor 引用刷新继续使用授权直接操作，区间和轨迹没有直接操作回退。

Worker 在提交前将计划写入现有 `world_query`，受理后先保存 Gateway 任务标识再轮询；恢复复用原计划、幂等标识及原截止时间，所有数据库写入受租约代际约束。返回结果验证整体和节点哈希、发布 Schema、回执以及 requested/effective 快照。没有执行的依赖节点不会伪造输入哈希或回执；Gateway 明确标记 `NODE_NOT_EXECUTED` 的跳过节点保留原域状态，不作为已执行节点的快照失败。

现场诊断必须区分快照适配成功与业务完成。区间为 `PENDING`、`NO_DATA` 或无可用引用时，轨迹被跳过，高级分析不能计作成功。原始数据、历史结果、追问有效期和生产延期范围保持原规则。诊断候选结束后停止 API/Worker，不自动激活。

模型解析会在任务原截止时间内为后续处理保留最多 30 秒（剩余不足 60 秒时保留一半）。预算耗尽以 `MODEL_BUDGET_EXCEEDED` 结束必需模型解析，不延长总截止时间。到期清理的公开阶段来自持久化流水线阶段；历史依赖熔断应表现为上游不可用，不应通过删除契约注册信息变成“未注册”。已有任务的冻结快照不会自动刷新。
