# N05 Structured World Selection Phase Report

## Decision

`WSGS_V021_STRUCTURED_SELECTION_READY`

N05 source, contract, API-boundary, and unit evidence pass. PostgreSQL receipt persistence remains owned by N07; SACS consumer qualification remains owned by N09; no runtime or production qualification is claimed here.

## Implemented boundary

- Added `@wsgs/structured-world-selection` as an isolated parser, resolver, and opaque-token authority.
- Added authenticated `POST /v1/world-selections:resolve` for negotiated `sacs-wsgs-grounding/1.1` callers.
- Derives principal, actor, data scope, and authorization binding only from the authenticated context.
- Validates prior grounding/result, finding/feature membership, source-product content hash, and monotonic selection revision.
- Returns exactly one of an upstream GOWM `ReferenceKey` or a WSGS-owned encrypted selection token.
- Uses AES-256-GCM with a bounded `keyId` key ring, active-key rotation, expiry, and authenticated binding of every selection and authority field.
- Never records token plaintext in generated evidence.
- Keeps `VALIDATE_SOURCE_CURRENTNESS` explicitly unavailable until N06.

## Focused verification

| Command | Result |
|---|---|
| `npm exec -- vitest run packages/structured-world-selection/src/index.test.ts services/grounding-api/src/server.test.ts services/grounding-api/src/production-capabilities.test.ts` | PASS, 26/26 |
| `npx tsc -b packages/structured-world-selection packages/grounding-pipeline services/grounding-api --pretty false` | PASS |
| `npm run selection:write` | PASS, 13 executed source/unit cases |
| `npm run selection:check` | PASS, deterministic regeneration |
| `git diff --check` | PASS |

## Evidence

- `reports/sacs-geospatial-v1/N05-selection-contract.json`
- `reports/sacs-geospatial-v1/N05-token-security.json`
- `reports/sacs-geospatial-v1/N05-replay.json`

## Qualification boundary

- Source/contract/unit: PASS
- API boundary: PASS under in-process authenticated tests
- Same-token restart verification and retained-old-key rotation verification: PASS
- Durable receipt replay/PostgreSQL restart: NOT_RUN, N07 owner
- Real SACS consumer: NOT_RUN, N09 owner
- Real 18-case chain: NOT_RUN, N10 owner
- `productionQualified`: false
