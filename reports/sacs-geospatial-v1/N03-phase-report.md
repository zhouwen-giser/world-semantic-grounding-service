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
| Focused execution evidence bound to current input set | PASS; `sha256:cccb871e74c098ff678f21a6e64a13e3845cb939a4274ffbb3b6f7c3ae0939f4` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:db993d642fff321e9fcc5d00d77d0ec4cb15248306fd5be9b6362ec232343350` |
| `GAP_NORMALIZATION` | `sha256:5f183f34dd012129fa91133c6f70ce686f194248d176e55e616e620fe1868b0a` |
| `SCOPE_NEGATIVE_CASES` | `sha256:2ed2f0e79bc1cbed4ce515d84723cad75fcd948e118903efee0b606c789e8ceb` |
| `FOCUSED_TEST_EXECUTION` | `sha256:cccb871e74c098ff678f21a6e64a13e3845cb939a4274ffbb3b6f7c3ae0939f4` |
| `PROVENANCE_REPORT` | `sha256:7e0f5e89e695c374e09c734b943286d88233ac3c56765385155d40438d1678a1` |

Input-set hash: `sha256:b19377203c594b0e8497153a0816797a833cb40a1131ba0dd490ac8b04cb315b`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
