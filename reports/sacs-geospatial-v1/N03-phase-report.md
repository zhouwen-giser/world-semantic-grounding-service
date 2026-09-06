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
| Focused execution evidence bound to current input set | PASS; `sha256:768e071304796e11adc9c2fcdf77a9cf1a21b69d181606147aee889c04049754` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:140e04f1fbebf2f5c5512d99708f5cb63a95f51ed276fbec4c8e0203437439b3` |
| `GAP_NORMALIZATION` | `sha256:2da8253498f9de9ffba64caf7c9088627233a394bbec3c8f548150b83fbf0461` |
| `SCOPE_NEGATIVE_CASES` | `sha256:c64d002ed0b47bee27ef400a6049c67ec361b7da4c73a45fae83424ef35d7899` |
| `FOCUSED_TEST_EXECUTION` | `sha256:768e071304796e11adc9c2fcdf77a9cf1a21b69d181606147aee889c04049754` |
| `PROVENANCE_REPORT` | `sha256:4d63eb03d2c18fcf1c125363aba87555e37644f9730c795f0d1d5a20ce520ebc` |

Input-set hash: `sha256:ec92c913c562da5b2733b327de867e60ba8f6113748e440c66e3e76f7a270420`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
