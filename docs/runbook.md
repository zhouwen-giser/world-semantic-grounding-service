# WSGS 0.1 Runbook

## Candidate status

The repository is a blocked 0.1.0 candidate. Contract, component, security, PostgreSQL, build, and container gates pass. Real semantic-model and GOWM Gateway/provider gates have not run. The executable entrypoint therefore uses a fail-closed deployment backend: liveness is 200, readiness is 503, and grounding creation cannot claim success.

Do not route production SACS traffic until a production backend composes the durable store, parser/model, Gateway client, grounding graph, compiler, and normalizer, and W16 is rerun successfully.

## Local verification

```powershell
npm ci
npm run check
npm run build
```

Real PostgreSQL verification:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:PORT/DATABASE'
npm test -- --run packages/runtime/src/job-store.integration.test.ts
```

## Authentication

Production default is `JWT_SERVICE` and requires:

- `WSGS_JWT_HS256_SECRET` with at least 32 UTF-8 bytes;
- `WSGS_JWT_ISSUER`;
- optional `WSGS_JWT_AUDIENCE`, default `wsgs`.

`STATIC_TRUSTED` is development-only and requires `WSGS_STATIC_PRINCIPAL_ID`, `WSGS_STATIC_ACTOR`, and `WSGS_STATIC_DATA_SCOPE`. Request bodies never supply trusted scope or identity.

## Container smoke test

```powershell
docker build --tag wsgs:0.1.0 .
docker compose up --build
```

The compose profile binds only to loopback, runs UID/GID 10001, uses a read-only root filesystem, denies new privileges, bounds `/tmp` to 16 MiB, and allows 15 seconds for shutdown. `/health/live` must return 200. `/health/ready` must remain 503 until the production pipeline and required external capabilities are configured and verified.

## W16 resume checklist

Provide without printing secrets:

- `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_ID`, `MODEL_MODE`, `MODEL_TIMEOUT_MS`, `MODEL_MAX_RETRIES`;
- `GOWM_GATEWAY_BASE_URL`, `GOWM_GATEWAY_TOKEN`, `GOWM_DATA_SCOPE`;
- isolated `TEST_DATABASE_URL`;
- the locked GOWM 0.4.0 required providers, operations, schemas, and representative scoped data.

Then rerun all acceptance entries currently marked `BLOCKED` in `reports/wsgs-v0.1/required-acceptance-ledger.json`. Do not turn the Draft PR Ready or emit completion markers until every required gate passes.

## Rollback and incident handling

- Stop intake and send SIGTERM; the API closes gracefully and bounded local work receives cancellation after its grace period.
- Durable jobs remain authoritative in PostgreSQL. Expired leases are reclaimed; terminal states never regress; late completion after cancellation is ignored.
- Rotate JWT, model, and Gateway credentials outside the image. Logs and public errors must not contain their values.
- Do not modify GOWM provider databases or bypass the Gateway during recovery.
