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
| Focused execution evidence bound to current input set | PASS; `sha256:60d186987e5c5972899ffaed5d1fcf591a4e0abdb9b42a0c5184b6487b4f6cc9` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:8267fd88c338eaba05a016895767e0f09b187e34a2bd84818ef0f1074917216d` |
| `GAP_NORMALIZATION` | `sha256:7a070a49d9007074175d064ce206b118ba368decc472328f749508f9c2e6f64e` |
| `SCOPE_NEGATIVE_CASES` | `sha256:8c462e6530cf7916ae65beea1601a3ff8c1dbc5b532cddce8a298089ef55e246` |
| `FOCUSED_TEST_EXECUTION` | `sha256:60d186987e5c5972899ffaed5d1fcf591a4e0abdb9b42a0c5184b6487b4f6cc9` |
| `PROVENANCE_REPORT` | `sha256:e5427cc4ced1f8e32b59637dbbafe3942ec91f2ab80a36c9fd32548d0cb5007b` |

Input-set hash: `sha256:20cc0d065abd1c5177d68b0dbaf8305b29b8749e3257b1d3366e1134deaee8d5`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
