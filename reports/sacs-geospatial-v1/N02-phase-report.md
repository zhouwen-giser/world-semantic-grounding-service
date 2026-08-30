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
| `reports/sacs-geospatial-v1/N02-decoder-coverage.json` | `sha256:1bcdd36fee42aab91aac9a89337fc48c0907f96dba6f922f28c94bede7d45378` |
| `reports/sacs-geospatial-v1/N02-determinism.json` | `sha256:e34840847db5bd7781e22a160db7fc9f85b326bf9421b9be6e12cf8533cc8bb5` |
| `reports/sacs-geospatial-v1/N02-negative-cases.json` | `sha256:1f2d2612f5d02527b4e27de11e1ada0def34911ab74db29405d7ba0e398513fb` |
| `reports/sacs-geospatial-v1/decoder-report.json` | `sha256:e38a34a24c40f2221358363915429b3552fd806fb0355a33742685306697a504` |

Common deterministic input-set hash: `sha256:4787807de58a7c642256beffeedb38a9be4d0c0ca6fd6e4abe57a4dcd563016b`. The aggregate binds the raw bytes of all three detailed JSON reports. It intentionally does not hash itself or this phase report.

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
