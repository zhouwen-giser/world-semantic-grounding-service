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

All generated evidence is content-addressed, contains no wall clock or absolute local path, and was generated once then checked twice without drift. The deterministic JSON records the verification recipe with `embeddedExecutionClaim=false` and `exitCode=null`; actual command results are recorded in this phase report and hosted CI rather than fabricated inside generated output.

| Artifact | SHA-256 |
|---|---|
| `contracts/wsgs-v0.2.1-sacs-geospatial/contract-release-lock.json` | `sha256:77573e3d2912ef29c7f3c0bba1233934b2cdacd832446278a713effee5c70fc0` |
| `reports/sacs-geospatial-v1/N01-contract-diff.json` | `sha256:4807b9766f8526eb0239b4f325e9de97ccbb43f20e2c01b78c43e13270d7b79d` |
| `reports/sacs-geospatial-v1/N01-schema-validation.json` | `sha256:0aea1fbd461be52b784de0ba8e19f5e5d68e6e12300d01ace72ea6e3a5bb9037` |
| `reports/sacs-geospatial-v1/N01-sacs-schema-compatibility.json` | `sha256:9c1af7f5e39a70a8173d3fd6b61a9bc21de5f7bc22fcad49e7b942a2092c1046` |

Common deterministic input-set hash: `sha256:e84f1708518c0348492ec49bca78746197f8ce820862eabe934125f516d992cf`.

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
- V21-G02: NOT_RUN as a cross-phase gate. Package/workspace, OCI source, compose, README, and CHANGELOG surfaces are aligned, while runtime capabilities are explicitly deferred to N04 and authoritative handoff metadata to N08.
- V21-G04–V21-G14: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases executed: 0/18.
- Consumer compatibility: false; current SACS PR #17 still lacks the fifth operation, exact 8+1 intake, and real 18-case runner.
- G1: NOT_RUN.

## Delivery

Branch: `codex/wsgs-v0.2.1-sacs-geospatial-handoff`.

Draft PR: [#10](https://github.com/zhouwen-giser/world-semantic-grounding-service/pull/10), OPEN Draft.

This report intentionally does not hash itself. The N01 commit binds source, contracts, generated artifacts, evidence, and this report. The next permitted phase after that commit is pushed is N02 only.
