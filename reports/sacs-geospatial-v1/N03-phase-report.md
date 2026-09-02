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
| Focused execution evidence bound to current input set | PASS; `sha256:2b9970b0fe50c6d3c2d5bbb5ce8dce4f09c0df8b343c6dd01b96ad5c0913a8e6` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:963032d848fa3a7c9ed157a7438cec99b838f48bbb022ddfbe6c6a9f027257c4` |
| `GAP_NORMALIZATION` | `sha256:cda3544538e4e149fb9a5663b211f4a260a9d41a714df2b077a4072b65f2b8eb` |
| `SCOPE_NEGATIVE_CASES` | `sha256:6460459bc14be0464956e0b1124aeeb30caf3613c0db7914819eec0f2f7092bb` |
| `FOCUSED_TEST_EXECUTION` | `sha256:2b9970b0fe50c6d3c2d5bbb5ce8dce4f09c0df8b343c6dd01b96ad5c0913a8e6` |
| `PROVENANCE_REPORT` | `sha256:65182a3e51a826aad8812ebe80ffc9aebbfffc804b308787c287c5ea18aa09fd` |

Input-set hash: `sha256:2d88baaf18e8d5f9d3f3f1c4f73063811442a39179028459a57982778e4bc3ab`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
