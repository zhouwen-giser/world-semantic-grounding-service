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
| Focused execution evidence bound to current input set | PASS; `sha256:00e2e45e710d25a84075a19829cae5356107b3e01e8a41d0b78b3c44076069e8` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:b7e886a44bb142e87823c83cb8369c006c81ec37cf6edfc53673e285d4c9e13c` |
| `GAP_NORMALIZATION` | `sha256:b8e45aa96a805d05d4dda7d3c372bee21ee14a0033d905dad3ccb7c04300ac8b` |
| `SCOPE_NEGATIVE_CASES` | `sha256:4ecce7f4cd906ab381d0ec3972662ba160d9b5dd36e68ae98b8a4024504e0914` |
| `FOCUSED_TEST_EXECUTION` | `sha256:00e2e45e710d25a84075a19829cae5356107b3e01e8a41d0b78b3c44076069e8` |
| `PROVENANCE_REPORT` | `sha256:c5f8e292da3bf0b463bbb8d00a20e40a232ca1fd121759205107547adab38783` |

Input-set hash: `sha256:f85a151f4b65dabda80f8b883515775e7c82e60c5ea4980061ae5dc87a4697c2`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
