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
| `reports/sacs-geospatial-v1/N02-decoder-coverage.json` | `sha256:2f2f7f1d724d50149333a35335cb81240e652700e69458b398330d9ed9772e91` |
| `reports/sacs-geospatial-v1/N02-determinism.json` | `sha256:ca49ac91dfc2f3f74ffb357fe9e6dd627c153e118aafb244f74026457ea73842` |
| `reports/sacs-geospatial-v1/N02-negative-cases.json` | `sha256:1a875083096528e9022f2977edcf6a4cb537cd29d453f27aa26fd8be3fa12c8e` |
| `reports/sacs-geospatial-v1/decoder-report.json` | `sha256:2e6c9e3b0d8e39839ef2a32db3faa77b4d91bc93f69c269b4901a7a56e495da9` |

Common deterministic input-set hash: `sha256:901cee3e260b3c4953744940ef2b29df981e13ce6dfc481bef05a5820e09aa21`. The aggregate binds the raw bytes of all three detailed JSON reports. It intentionally does not hash itself or this phase report.

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
