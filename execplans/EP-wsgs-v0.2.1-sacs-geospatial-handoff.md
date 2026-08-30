# WSGS v0.2.1 Authoritative SACS Geospatial Handoff

Status: N03 complete; N04 is next; G1 NOT_RUN; productionQualified=false.

## Purpose and non-goals

This plan delivers the authoritative `sacs-wsgs-geospatial-findings/1.0` northbound handoff in strict N00–N11 order. It does not merge a PR, tag, release, deploy, mutate shared GOWM/GDPS/SACS instances, or qualify production. The v0.3.0 branch is forbidden until G1 passes.

## Authority and safety order

1. The user's request and explicit authorizations.
2. `WSGS_V0_2_1_V0_3_0_CODEX_GOAL_TASK_PACKAGE_CN.md`.
3. `wsgs-goal-phase-manifest.json`.
4. Current authoritative repository contracts and exact online source heads.

SACS, GOWM, and GDPS are read-only upstream/consumer authorities. WSGS never accepts principal, scope, authorization, or token authority from request bodies and never bypasses the GOWM Gateway to a Provider or database.

## Source reconciliation

### Current heads

| System | Current source | Current contract/version | Classification |
|---|---|---|---|
| WSGS | `main@318e02a0d77ceb696d46503ab1884ce5d4d17efd` | `VERSION=0.2.0`, root package `0.2.1` | selected development base; not a qualified v0.2.1 runtime |
| GOWM | `main@d69db9b137061f73e07fb75205b0c1fdaa506045` | runtime/package/Gateway contract `0.7.0` | current source head only; no silent runtime-lock upgrade |
| GDPS | `main@bad1de09d15e0145d08f16647ed067964420b8cb` | provider `0.2.1` | current source head containing FINAL_B delivery |
| SACS v0.4 | PR #17 `951a1d81d640d24de60ce6eacc8bb6f95eb6ac35` | provisional geospatial consumer | exact consumer baseline; currently incompatible with the required fifth operation |
| SACS v0.5 | PR #18 `06c286433dedc8c5887eb887238628d9e588efef` | 28-case analysis corpus | observation only before G1 |

### Existing qualified tuples

| Tuple | Exact binding | Permitted claim |
|---|---|---|
| WSGS ↔ GOWM 0.6.4 | WSGS runtime source `b3315cbb5dce9635911a90ac095b93b1efab8e70`; GOWM source `fceed92398a0b86c0a0121aa2188a7f1d328e577`; runtime `0.6.4`; Gateway contract `0.6.3` | DEVELOPMENT_READY, R1–R5 5/5, productionQualified=false |
| GDPS FINAL_B | GDPS implementation `42e06e7341250aa230ac01d201effafe92ce4af5`; evidence `712abb35c6c11fe96a3ff1f4c990d26bb5fb06d6`; GOWM lock `7a3600cfeede1e1eda711a59bdb76caa68c05f64`; WSGS lock `bcad5b05491208f4b549f937cf6e9a62f936d6cb`; bundle `sha256:93ebb1fdf376e416cdc38ffac0dde14470993fa09b576867a52a7249f5c0eb19` | upstream development-qualified evidence only; W43/W44 NOT_RUN |

These tuples are independent and must not be cross-producted into a synthetic runtime identity.

### Non-main consumer materialization

`codex/wsgs-v0.2-descriptor-gdps-closure-resume@14abec44e104c8f1b600a9a8d282ed5a1212bfde` contains the `bcad5b0…` FINAL_B consumer implementation. Its merge base with current main is `65c3716f956c688f48e08a43322548b75af849b8`; it is not an ancestor of current main. It is reconciliation input, not the new base and not new runtime evidence.

## Selected development baseline

- WSGS base: `318e02a0d77ceb696d46503ab1884ce5d4d17efd`.
- SACS v0.4 consumer: `951a1d81d640d24de60ce6eacc8bb6f95eb6ac35`.
- Runtime qualification: NOT_RUN.
- Qualified source SHA/runtime identity: unset until exact-head runtime gates pass.
- Rule: never combine distinct qualified tuples or inherit old evidence after source drift.

## Frozen public decisions

- Wire `GroundingResult.schemaVersion`: `1.0`.
- Additive capabilities contract: `sacs-wsgs-grounding/1.1`.
- Legacy `sacs-wsgs-grounding/1.0` bytes and hash remain unchanged.
- Profile: `sacs-wsgs-geospatial-findings/1.0`.
- Transport: `RESULT_EXTENSION` through `GroundingResult.geospatialFindings`.
- Currentness: `DEDICATED_OPERATION` / `VALIDATE_SOURCE_CURRENTNESS`.

## Architecture invariants

Decoders, finding projection, provenance normalization, selection tokens, currentness, and handoff materialization remain separate testable modules. `production-module.ts` is only a composition root. All IDs exposed in evidence are safe hashes; credentials, internal Provider URLs, database identifiers, asset paths, and raw reference IDs are forbidden.

## Version reconciliation

N01 will align mutable surfaces to `0.2.1`: `VERSION`, root/workspace package manifests and lockfile entries, OCI image label/tag, runtime capabilities, new handoff metadata, README, and CHANGELOG. Frozen `contracts/wsgs-v0.1/**`, historical evidence, and vendored upstream authority versions are not rewritten. Contract 1.1 is additive.

## Baseline health

`npm ci` passed. The first `npm run check` on untouched `origin/main` exited 2 at typecheck with pre-existing TS7016 in `services/grounding-api/src/production.integration.test.ts:6:33` for `@wsgs/runtime`. Contract, GOWM intake, GDPS v0.2.1, architecture, and 63/63 development-closure gates passed before that failure. N00 preserves this failure as an input fact; it is not attributed to N00.

## Serial phase ledger

| Phase | Prerequisite | Objective | Marker | State |
|---|---|---|---|---|
| N00 | current online sources | reconcile sources, plan, matrix, consumer baseline | `WSGS_V021_BASELINE_LOCKED` | COMPLETE |
| N01 | N00 pushed | additive 1.1 and geospatial profile contracts | `WSGS_V021_GEOSPATIAL_CONTRACT_READY` | COMPLETE |
| N02 | N01 pushed | descriptor/profile-driven six-kind decoder registry | `WSGS_V021_FINDING_DECODER_READY` | COMPLETE |
| N03 | N02 pushed | SourceProduct, typed gaps, provenance | `WSGS_V021_GEOSPATIAL_PROVENANCE_READY` | COMPLETE |
| N04 | N03 pushed | API, capabilities, result-extension runtime | `WSGS_V021_RESULT_EXTENSION_READY` | NOT_RUN |
| N05 | N04 pushed | structured selection and opaque token | `WSGS_V021_STRUCTURED_SELECTION_READY` | NOT_RUN |
| N06 | N05 pushed | dedicated source currentness operation | `WSGS_V021_CURRENTNESS_READY` | NOT_RUN |
| N07 | N06 pushed | PostgreSQL migration, replay, restart, recovery | `WSGS_V021_PERSISTENCE_READY` | NOT_RUN |
| N08 | N07 pushed | exact 8+1 authoritative handoff | `WSGS_V021_HANDOFF_PUBLISHED` | NOT_RUN |
| N09 | N08 pushed | exact SACS v0.4 consumer compatibility | `WSGS_SACS_V04_CONSUMER_COMPATIBLE` | NOT_RUN |
| N10 | N09 pushed | real 18-case end-to-end gate | `WSGS_SACS_V04_REAL_E2E_QUALIFIED` | NOT_RUN |
| N11 | N10 pushed | exact-head closure, CI, delivery audit | `WSGS_V0_2_1_DEVELOPMENT_COMPLETE` | NOT_RUN |

Each phase follows implement → focused tests → evidence → phase report → independent commit → immediate push → Draft PR update.

## Evidence policy

Accepted evidence classes are SOURCE, CONTRACT, UNIT, POSTGRES_INTEGRATION, REAL_UPSTREAM, REAL_CONSUMER, CI, and DELIVERY. Fixtures, mocks, static JSON, old runtime reports, and HTTP health alone cannot satisfy real runtime classes. Every actual evidence record binds artifact hash, command/exit, inputs, exact source SHA, runtime identity, and consumer SHA.

N02 source/contract/unit evidence is bound by `reports/sacs-geospatial-v1/decoder-report.json` to the raw hashes of `N02-decoder-coverage.json`, `N02-determinism.json`, and `N02-negative-cases.json`. It records 30/30 classified capability locks (29 supported, one N06-owned non-finding capability), ten authoritative TEST_VECTOR shape executions across six finding kinds, three byte-identical runs, four ordering/identity permutations, independent finding-set hash recomputation, and 32 fail-closed/static-boundary cases. Runtime, SACS consumer E2E, G1, and production qualification remain NOT_RUN/false.

N03 source/unit evidence is bound by `reports/sacs-geospatial-v1/provenance-report.json` to the complete provenance-normalization input set and a sanitized focused-test execution attestation. The four focused suites pass 116/116 and cover SourceProduct, typed gaps, result-local foreign keys, scope negatives, and receipt/evidence determinism. The real signed Gateway-only `geo-product.get@1.0` gate qualified exact source `9d22e90366ce2233d6ff1d1742a8888c946b64f4`: HTTP 200, terminal COMPLETED, one SourceProduct, one Finding, one EvidenceItem, zero gaps, and zero direct Provider/database calls. V21-G06 and the N03 marker are PASS. N04 must bind `subjectReferenceProductIds` from the opaque, result-local ReferenceProduct set before exposing the extension; duplicate semantic envelope aggregation remains fail-closed until a stable node/input identity or deterministic receipt merge is defined.

## Real SACS v0.4 gate

The exact cases are E2E-01–E2E-10, NEG-01–NEG-07, and HYBRID-01 (18 total). The only qualifying path is SACS_HTTP → WSGS_HTTP → WSGS_POSTGRES_QUEUE_WORKER_PIPELINE → GOWM_WORLD_CAPABILITY_GATEWAY → GDPS_CURRENT_PRODUCT → REAL_POSTGRES. The current PR #17 has no such 18-case runner and currently rejects the required fifth operation; G1 remains fail-closed until an exact updated consumer head exists and all 18 cases really execute.

## Authoritative handoff

N08 must materialize exactly eight business JSON files plus `CHECKSUMS.json`; the checksum file covers exactly those eight files and the canonical bundle hash is recomputed. Extra, missing, stale, secret-bearing, or hash-drifted files fail closed.

## G1 transition

G1 requires V21-G01–G14 PASS, 18/18 real cases, PostgreSQL/recovery, exact-head clean source, green CI, an updated Draft PR, authoritative handoff intake, and `productionQualified=false`. Before that point no v0.3 branch or content may be created.

## Delivery strategy and non-claims

Branch: `codex/wsgs-v0.2.1-sacs-geospatial-handoff`, based on `origin/main@318e02a…`. The Draft PR title is `feat: publish authoritative SACS geospatial handoff`. No force-push, merge, tag, release, deploy, or shared-instance mutation is permitted. Failed attempts and drift remain recorded rather than deleted or rewritten.
