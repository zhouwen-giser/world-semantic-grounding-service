# N04 Phase Report — API, Capabilities, and Result Extension Runtime Integration

Decision: **PASS for N04 source and qualified isolated-WSGS real runtime integration**

Marker: `WSGS_V021_RESULT_EXTENSION_READY`

G1: `NOT_RUN`

Qualified runtime source: `fc2601f13ce1481fcb297811dfc147787a9464f8`

Shared WSGS runtime: `NOT_RUN`

SACS v0.4 real E2E: `0/18 NOT_RUN`

productionQualified: `false`

## Contract decision

- `sacs-wsgs-grounding/1.0` remains byte-stable and never receives `geospatialFindings`.
- The allowlisted, explicitly negotiated `sacs-wsgs-grounding/1.1` path returns Profile `sacs-wsgs-geospatial-findings/1.0` through `RESULT_EXTENSION`.
- Duplicate or comma-joined negotiation headers fail closed. Request bodies, User-Agent, Accept, and source text do not select a contract.
- GET and cancel bind the authenticated principal, actor, data scope, and exact persisted contract selection.
- N05 `RESOLVE_WORLD_SELECTION` and N06 `VALIDATE_SOURCE_CURRENTNESS` remain unavailable, so 1.1 `requiredCapabilitiesReady=false` is intentional and truthful.

## Result integrity

- The complete Result, including the extension, is canonicalized before hashing and persistence.
- `resultHash` and nondeterministic `execution.elapsedMs` are excluded from the hash preimage.
- The final canonical Result bytes are checked against `maxResultBytes`; oversized upstream inline payloads are quarantined before Finding decoding.
- Persisted replay uses the immutable negotiated selection; a legacy request cannot retrieve or cancel a 1.1 presentation.

## Qualified real-runtime receipt

| Evidence | Result |
|---|---|
| Signed Gateway boundary | `PASS`; WSGS direct Provider calls = `0`; WSGS direct upstream database calls = `0` |
| Fresh synchronous POST / persisted GET | `200` / `200` |
| Asynchronous POST / persisted GET | `202` / `200` |
| Synchronous idempotent replay | HTTP `200`; additional Gateway executions = `0` |
| Terminal result | `COMPLETED`; extension findings/source products/evidence/subjects = `1/1/4/1` |
| Persisted bytes and Result hash | `PASS`; extension included and elapsedMs excluded |
| Legacy 1.0 compatibility | `COMPLETED`; unnegotiated `geospatialFindings` absent |
| Cross-contract persisted read | HTTP `406` fail-closed |

The repository has no unified machine-readable focused-test receipt consumed by this generator. Source gates are content-hash locked, but no unit or integration case count is inferred or claimed here. N04 readiness is conditional on the separately generated real-runtime report passing strict field, source-commit, source-tree, source-input, and canonical report-hash validation.

## Evidence hashes

- `N04_CAPABILITIES`: `sha256:e31e4467e7a15dc598c3660ddb52cab54ff0116072b2ecf8bcc1a5df2ea81f1e`
- `N04_API_CONTRACT`: `sha256:cdec4ceb38301834d679e76eedc7cc74a5e3db4878717fd8564b267f3174b784`
- `N04_RESULT_HASH`: `sha256:7b420c1e55b2d0a5290a702ff750030a08a5f1ac8b6b8c2e4a9748a608e15147`

Input-set hash: `sha256:6c831af9fc288a6d6fe1b406415fc5f0ae0e8ef49c29236218c3ed9650b48527`.

Real-runtime report hash: `sha256:da2251a00bc4c18f1366a2fb54b6404b9ecc8c3c2f38bb5af90a6b75368a428e`.

Real-runtime report file hash: `sha256:17a42754f3dfe2527c945bd707b2dbf9a8ac272fe378f8df86f7d59478816cc9`.

## Qualification boundary

- This phase does not claim G1, SACS 18-case execution, consumer compatibility, or shared-runtime qualification.
- No shared instance was modified or restarted.
- No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
