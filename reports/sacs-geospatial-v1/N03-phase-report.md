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
| Focused execution evidence bound to current input set | PASS; `sha256:77e203303a61b88a915f07ccc12406f374deb244b19c26644187dc8eb1979818` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:d33fb1e599a08750000992a3112261217cf4bc1e1a1df9f7b458fde278edad7a` |
| `GAP_NORMALIZATION` | `sha256:df981262952f11b374695eb7a29bc7d16a1be53fe153f9cfdf33367ae0fa868c` |
| `SCOPE_NEGATIVE_CASES` | `sha256:0dad30fde9265790f9198694a8c2930e6fcaa29b18107f1624d634b4090afc19` |
| `FOCUSED_TEST_EXECUTION` | `sha256:77e203303a61b88a915f07ccc12406f374deb244b19c26644187dc8eb1979818` |
| `PROVENANCE_REPORT` | `sha256:447486e5afae33275e830d09870b96de2209bbe9a284fefd0bfd085c990d6ba7` |

Input-set hash: `sha256:8478e531d6e43ec8e6584baa0dda0ce2d5e9563c3f866726c6bf9d0fa9ff0b27`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
