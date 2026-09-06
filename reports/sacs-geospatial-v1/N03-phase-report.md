# N03 Phase Report — SourceProduct, TypedGap, and Provenance

Decision: **PARTIAL for N03 only**

Marker: `NOT_EMITTED`

G1: `NOT_RUN`

v0.3 branch allowed: `false`

productionQualified: `false`

## Scope

- SourceProduct identity is derived from exact validated GDPS product/descriptor values and exact product-or-catalog snapshots.
- Provenance admission is opaque, scope-bound, and fail-closed. Recoverable qualification failures produce zero facts and a blocking typed gap.
- Grounding evidence uses the existing v0.1 wire item, retains safe snapshot/receipt references, and preserves actual GDPS output schema locks.
- Finding, SourceProduct, EvidenceItem, and TypedGap foreign keys, identity collisions, ordering, limits, and set hashes are checked result-locally.
- FAILED/INDETERMINATE cannot become NO_DATA; PARTIAL empty collections remain PARTIAL; empty plus truncated is contradictory.

## Verification

| Gate | Result |
|---|---|
| Focused source/gap/result/registry tests | PASS; 120/120 across 4 suites |
| Focused execution evidence bound to current input set | PASS; `sha256:b85bea28f8a614e3be64d0f5d3cdf99f84c343fb45d85908e735d375c231d963` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:93304a55f96c34948bf8093cecfa84f5f00ddb47f6cff05d5357a8ff79bf1580` |
| `GAP_NORMALIZATION` | `sha256:8dc9043f091684c6e9d2980aadbf896c314c004ebd2950ceda46bd668ce3d32f` |
| `SCOPE_NEGATIVE_CASES` | `sha256:e51b0de9312f584bf2c7c076c7a78b06adea8dc1965dbb5bff16f1e0842c76df` |
| `FOCUSED_TEST_EXECUTION` | `sha256:b85bea28f8a614e3be64d0f5d3cdf99f84c343fb45d85908e735d375c231d963` |
| `PROVENANCE_REPORT` | `sha256:182f13a349d5264b3b1a025980046c74ca0b4b430df410006f987a0fa1278d21` |

Input-set hash: `sha256:8b011f43cd99710c309276867550a9980b97f7ca9c2b92ba522fbe899c6ebeb7`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
