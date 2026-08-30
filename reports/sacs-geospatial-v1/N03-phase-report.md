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
| Focused source/gap/result/registry tests | PASS; 116/116 across 4 suites |
| Focused execution evidence bound to current input set | PASS; `sha256:883ce6a1b97b06750b4f1d41fed7de339212f780208e4630d970914b664fc55a` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:1022ea26e95fb9d7456f9ce6dd49dd9050c02c7789a0adbb484077a614573c6a` |
| `GAP_NORMALIZATION` | `sha256:ebe91b6356e1b21980e608a99b7ea5202aad66ae71357eb91782abae7c826489` |
| `SCOPE_NEGATIVE_CASES` | `sha256:cf40e916f1e972ac06b92f444951cc80a809dd97e9fae8437410436b7c6730ff` |
| `FOCUSED_TEST_EXECUTION` | `sha256:883ce6a1b97b06750b4f1d41fed7de339212f780208e4630d970914b664fc55a` |
| `PROVENANCE_REPORT` | `sha256:364da8cdad7ad860e4f1785902ed49457e98c33070698b509f4b309bb5e87e44` |

Input-set hash: `sha256:e4b3359adf12ba9be9b3f5e698dcfa1b0f9e8fc970982c1a1ceead8715172f93`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
