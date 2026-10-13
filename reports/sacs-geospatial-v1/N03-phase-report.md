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
| Focused execution evidence bound to current input set | PASS; `sha256:432a2517f11aff3d417febe45687a49ea15d3b0e661da84853743868696e75de` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:9ee32f0aef85a309d0db823723d1028df4ee92b3e74cf7ad84821ea6fed72eee` |
| `GAP_NORMALIZATION` | `sha256:a2925dd18fbda8630a2dd170fd5c5dd658e23f3b13508231ce72cc2626b464c8` |
| `SCOPE_NEGATIVE_CASES` | `sha256:6b7d74da608ea99ff932c2a07624be3ff1a4eba8918f3e4aba6fff6efb98a365` |
| `FOCUSED_TEST_EXECUTION` | `sha256:432a2517f11aff3d417febe45687a49ea15d3b0e661da84853743868696e75de` |
| `PROVENANCE_REPORT` | `sha256:bd7bea85e78b7cfa56825d592786606bc34f38418f56e0582acab630a127fd7b` |

Input-set hash: `sha256:96fe4fb8924f98de92b01eacf011a16fa857aad242b9853ffa4e25252f896836`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
