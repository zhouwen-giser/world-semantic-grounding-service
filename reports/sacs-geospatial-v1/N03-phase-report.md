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
| Focused execution evidence bound to current input set | PASS; `sha256:9a35e8d7c63f6c9aca47e6f09c06ad07a407cc0639d3cd8f50efa484443bf3d2` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:58882056c8ad73163c43e7d8b43328537384a310268499c7abffa2fa6236aab6` |
| `GAP_NORMALIZATION` | `sha256:8e1ecd22c4a4af41f7b42180255d4b027b779ac22a75b3c50f2dae99946993b9` |
| `SCOPE_NEGATIVE_CASES` | `sha256:215198462a7695318ae203a6106d67ef40521648f4df96e2d5b08e69936dfc7c` |
| `FOCUSED_TEST_EXECUTION` | `sha256:9a35e8d7c63f6c9aca47e6f09c06ad07a407cc0639d3cd8f50efa484443bf3d2` |
| `PROVENANCE_REPORT` | `sha256:cbc115397c3bfff6b4eaed900f17ecb952a95f3ba346d883f67553af20b48791` |

Input-set hash: `sha256:553abfdaf952164c9213720f831d146ec0286005901149e37454746b00d40f77`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
