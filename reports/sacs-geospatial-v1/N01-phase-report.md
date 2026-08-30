# N01 Phase Report — Geospatial Northbound Contracts

Decision: **PASS for N01 only**

Marker: `WSGS_V021_GEOSPATIAL_CONTRACT_READY`

G1: `NOT_RUN`

v0.3 branch allowed: `false`

productionQualified: `false`

## Scope completed

- Aligned mutable WSGS software and workspace package surfaces to `0.2.1` without rewriting frozen history.
- Preserved `sacs-wsgs-grounding/1.0` byte-for-byte and released `sacs-wsgs-grounding/1.1` as an additive contract.
- Froze profile `sacs-wsgs-geospatial-findings/1.0`, transport `RESULT_EXTENSION`, extension field `geospatialFindings`, wire schema version `1.0`, and dedicated operation `VALIDATE_SOURCE_CURRENTNESS`.
- Added ten strict authoritative schemas, nineteen positive examples, eleven fail-closed cases, generated TypeScript types, and an embedded strict AJV registry.
- Checked WSGS-to-SACS compatibility and SACS-to-WSGS compatibility against the actual SACS PR #17 fixture projection: six findings and one source product.
- Repaired the inherited `@wsgs/runtime` TypeScript declaration path through an explicit workspace dependency and project reference; full repository typecheck now passes.

This phase implements contracts and source surfaces only. It does not claim runtime projection, handoff publication, real SACS execution, G1, or Development Complete.

## Frozen decisions

| Surface | Value |
|---|---|
| Software version | `0.2.1` |
| Legacy contract | `sacs-wsgs-grounding/1.0` |
| Additive contract | `sacs-wsgs-grounding/1.1` |
| GroundingResult wire schema | `1.0` |
| Result extension | optional top-level `geospatialFindings` |
| Profile | `sacs-wsgs-geospatial-findings/1.0` |
| Transport | `RESULT_EXTENSION` |
| Currentness mode | `DEDICATED_OPERATION` |
| Currentness operation | `VALIDATE_SOURCE_CURRENTNESS` |

The six advertised 1.1 operations are an exact unique set: the four legacy operations plus `RESOLVE_WORLD_SELECTION` and `VALIDATE_SOURCE_CURRENTNESS`. The legacy capabilities contract is unchanged.

## Contract inventory and strictness

The N01 release contains ten schemas: the nine geospatial/profile schemas required by the phase plus an independent capabilities 1.1 response schema. All published object boundaries are closed with explicit property whitelists. GeoJSON uses six strict geometry variants; generated coordinate and capabilities types do not degrade to `never[]`; `SpatialFeature` retains its common identity fields; source currentness is a four-branch discriminated union without an open index signature.

Validation results:

- authoritative schemas: 10/10 strict-compiled;
- positive examples: 19/19 PASS;
- fail-closed cases: 11/11 PASS;
- embedded registry tests: 3/3 PASS;
- actual SACS PR #17 consumer fixtures: 7/7 PASS;
- bidirectional schema cases: 14/14 PASS;
- generated contract artifacts: 37/37 deterministic;
- published object boundary scan: 0 open boundaries.

## Legacy compatibility

The original legacy lock remains:

`sha256:25d70b9b85b356f116a5ee2a881bae2b07ad41aa73a0e4786b77fba24876bc40`

`WSGS_CONTRACT_FREEZE_PASS schemas=19 examples=12 artifacts=32` confirms all 32 legacy artifacts. A byte-identical baseline copy is recorded under the new contract release, and the new 1.1 lock references the legacy lock rather than replacing it.

## Deterministic evidence

All generated evidence is content-addressed, contains no wall clock or absolute local path, and was generated once then checked twice without drift.

| Artifact | SHA-256 |
|---|---|
| `contracts/wsgs-v0.2.1-sacs-geospatial/contract-release-lock.json` | `sha256:77573e3d2912ef29c7f3c0bba1233934b2cdacd832446278a713effee5c70fc0` |
| `reports/sacs-geospatial-v1/N01-contract-diff.json` | `sha256:162f8b3474ebe88e41410676b1bf9500aaa762c8421be57b616103ad2d04d744` |
| `reports/sacs-geospatial-v1/N01-schema-validation.json` | `sha256:729cfd64cad48ac49813cce5ed8549809902818ecc59377bc45936057141adc5` |
| `reports/sacs-geospatial-v1/N01-sacs-schema-compatibility.json` | `sha256:0e5d0a4ff0fdbda7609aace5eb935e91376bec61aac5ea39e39f532d1497d9cb` |

Common deterministic input-set hash: `sha256:09bc79ea3eecfe734bb98908671ec99e22ccdbf9ad02a0b1422827b346677b71`.

## Verification

| Command or gate | Result |
|---|---|
| `npm run contracts:sacs-geospatial:write` | PASS; deterministic artifacts materialized |
| `npm run contracts:sacs-geospatial:check` (two independent checks) | PASS both times; `schemas=10 examples=19 negative=11 sacsBidirectional=14 legacyArtifacts=32` |
| `npm run contracts:check` | PASS; GOWM alignment, legacy, internal, GDPS, N01, and generated-type gates all passed |
| `npm run typecheck` | PASS |
| `npx vitest run tests/workspace.test.ts` | PASS 1/1; software, additive contract, and legacy contract constants are pinned |
| N01 schema registry focused tests | 3/3 PASS |
| Direct SACS PR #17 fixture projection validation | 7/7 PASS |
| Secret/path scan over N01 reports and release lock | PASS; zero forbidden value/path matches |

No shared WSGS, GOWM, GDPS, or SACS instance was modified or restarted. No credential, raw reference ID, Provider URL, database identifier, or internal topology was recorded.

## Acceptance snapshot

- V21-G01: PASS from N00.
- V21-G03: PASS.
- V21-G02: NOT_RUN as a cross-phase gate. Source and contract version surfaces are aligned, but runtime capabilities and the N08 authoritative handoff do not yet exist.
- V21-G04–V21-G14: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases executed: 0/18.
- Consumer compatibility: false; current SACS PR #17 still lacks the fifth operation, exact 8+1 intake, and real 18-case runner.
- G1: NOT_RUN.

## Delivery

Branch: `codex/wsgs-v0.2.1-sacs-geospatial-handoff`.

Draft PR: [#10](https://github.com/zhouwen-giser/world-semantic-grounding-service/pull/10), OPEN Draft.

This report intentionally does not hash itself. The N01 commit binds source, contracts, generated artifacts, evidence, and this report. The next permitted phase after that commit is pushed is N02 only.
