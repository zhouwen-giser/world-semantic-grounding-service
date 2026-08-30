# N02 Phase Report — Typed Geospatial Finding Decoders

Decision: **PASS for N02 only**

Marker: `WSGS_V021_FINDING_DECODER_READY`

G1: `NOT_RUN`

v0.3 branch allowed: `false`

productionQualified: `false`

## Scope completed

- Added a descriptor/profile-driven registry with strict priority `exact operation + schema > semantic profile > generic pattern`.
- Bound every positive decode to the materialized FINAL_B closure through the public no-argument authority factory, operation authority resolution, full GOWM envelope validation, and decoder-input minting; no caller-supplied descriptor/profile/schema lock is accepted.
- Converted ten authoritative GDPS TEST_VECTOR payload shapes and adapters into the six published WorldFinding kinds, including specialized-query-profile and generic nested-unit paths.
- Classified all 30 FINAL_B capability locks as 29 supported, 0 intentional gaps, 0 unsupported schemas, and 1 non-finding currentness capability owned by N06.
- Kept dynamic `geo-raster.sample` as one capability whose locked descriptor value semantics select measurement or classification.
- Enforced complete GOWM result-envelope validation, immutable schema/profile locks, deterministic finding/feature ordering, strict geometry, units, vocabularies, value ranges, no-data/empty semantics, and truncation gaps.
- Kept raw result passthrough, direct Provider access, and direct SQL out of the decoder package.

This phase is a source/contract/unit qualification only. It does not claim a shared running instance, SACS real E2E, consumer compatibility, G1, or Development Complete.

## Deterministic evidence

| Artifact | Raw SHA-256 |
|---|---|
| `reports/sacs-geospatial-v1/N02-decoder-coverage.json` | `sha256:5e13ce7206450fa209cd9d1ecb7f28eb6e32950f796aee9970d01e5ddf07e97b` |
| `reports/sacs-geospatial-v1/N02-determinism.json` | `sha256:21f1c3beb2998c31f5eabcddc17df19767abb230054df8edc8b0739a1e8c524f` |
| `reports/sacs-geospatial-v1/N02-negative-cases.json` | `sha256:2c739ffcc6a81f51768ca158abe0ea57b30eeefeeec1a3ec5ff048ee23a2f91d` |
| `reports/sacs-geospatial-v1/decoder-report.json` | `sha256:12acd9c4fa42969d3db719b3ffdc9ecdef83bed12bc2c2cd0d01d6498d482c37` |

Common deterministic input-set hash: `sha256:430ce6c2cff861aa1c55fe49c1a72c5b989aa6196da583904a9eb5dd7bb735a5`. The aggregate binds the raw bytes of all three detailed JSON reports. It intentionally does not hash itself or this phase report.

## Verification executed

| Command | Result |
|---|---|
| `npm run findings:decoder:write` | PASS; five deterministic artifacts materialized |
| `npm run findings:decoder:check` twice | PASS both times; no byte drift |
| `npx vitest run packages/northbound-geospatial-findings/src/registry.test.ts` | PASS; 47 focused decoder tests |
| `npm run typecheck` | PASS |
| `npm run architecture:check` | PASS |
| `npm run contracts:sacs-geospatial:check` | PASS; N01 contract lock unchanged |
| Static direct Provider/SQL route scan | PASS; zero routes |

The generated JSON records `embeddedExecutionClaim=false` and `exitCode=null`; actual command execution is recorded here and will be independently repeated by hosted CI.

## Acceptance snapshot

- V21-G05: PASS.
- V21-G01 and V21-G03 remain PASS from earlier phases.
- V21-G02 remains NOT_RUN as a cross-phase gate.
- V21-G04 and V21-G06–V21-G14 remain NOT_RUN.
- Runtime qualification: NOT_RUN.
- Consumer compatible: false.
- Real SACS v0.4 cases executed: 0/18.
- G1: NOT_RUN.

No shared WSGS, GOWM, GDPS, or SACS instance was modified or restarted. No credential, raw reference ID, Provider URL, database identifier, or internal topology is recorded.
