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
| Focused execution evidence bound to current input set | PASS; `sha256:1385fa09718eb71f7eb1c7c7a269b12367cbea10d3c9d15dcf24e87a542bd1a9` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:e40952dade1dfc10d663828d3b5223cb8d551cd43115c7cadea83d9cf00d4afa` |
| `GAP_NORMALIZATION` | `sha256:a4491e30f4d7e26cbf9d85953558406c3b6cccb49f9f067acfe44e25e4ddfe27` |
| `SCOPE_NEGATIVE_CASES` | `sha256:8fd9be7612c16dafb33cd22e9eba207821ee96f56683783580bb2c0cca397a3f` |
| `FOCUSED_TEST_EXECUTION` | `sha256:1385fa09718eb71f7eb1c7c7a269b12367cbea10d3c9d15dcf24e87a542bd1a9` |
| `PROVENANCE_REPORT` | `sha256:39a5932fe9da8757d46846f0ca87dd6b869e8403885340fabab793ac4be63378` |

Input-set hash: `sha256:efebdc4bd231b97d79921a5369318d389bf09217841f0155893d08499d8dfed7`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
