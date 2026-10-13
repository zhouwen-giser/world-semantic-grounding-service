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
| Focused execution evidence bound to current input set | PASS; `sha256:93ce018336171ea7762f091079b1520bc32c73fb43758ff06d20c69abc64c99f` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:0e5bac9274afe0b1e39d8baa71daed6a8548436115719ec2bc91ecfac0dbc4ad` |
| `GAP_NORMALIZATION` | `sha256:b1adcd19bbb2d51892af4f2e4dca0529adc0f7ffa5d6e05704598f87138ae2bc` |
| `SCOPE_NEGATIVE_CASES` | `sha256:f56c65eab2015bd0968dd3357ef0af9ca80fde5df4f70cac5a2af03b0aa84646` |
| `FOCUSED_TEST_EXECUTION` | `sha256:93ce018336171ea7762f091079b1520bc32c73fb43758ff06d20c69abc64c99f` |
| `PROVENANCE_REPORT` | `sha256:628b2cd9881a2fa9201e2b98874d6b51c30fc811e6ca91ae943c2d737334ee0e` |

Input-set hash: `sha256:534bd314d8f192d6c129b9cd781784e5e342bdd7894409cf9ef4b20bd3371316`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
