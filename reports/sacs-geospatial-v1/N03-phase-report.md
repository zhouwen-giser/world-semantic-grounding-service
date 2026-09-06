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
| Focused execution evidence bound to current input set | PASS; `sha256:06e9ad890958af979bc7049993da758ad8147243666b2a7e3e69b889606cdee5` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:1a1a853df2d5bf9cdfb2d495c29279be3bd932be620e7c813064c32425639668` |
| `GAP_NORMALIZATION` | `sha256:8c0d1793709fc2d6db94e2d332f0d7460f605ff49cfe3c90f9a981307a4e1884` |
| `SCOPE_NEGATIVE_CASES` | `sha256:0bb6886e14c46a0d00fd65bcf9a6fa22885cc39ae74d38134fc73c4b4b728422` |
| `FOCUSED_TEST_EXECUTION` | `sha256:06e9ad890958af979bc7049993da758ad8147243666b2a7e3e69b889606cdee5` |
| `PROVENANCE_REPORT` | `sha256:a41d8d87be76a30e8a8efed8fb96127d652b52ccb88711dcda9ade75f241d2e9` |

Input-set hash: `sha256:ea938cf7fe5b70fcabb3f161b95cdb98cdca6e38516e06f9a753ae1f02bd7d63`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
