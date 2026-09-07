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
| Focused execution evidence bound to current input set | PASS; `sha256:255d950169a1eb43d0b1e61355cecb8fd52885a5b62700fc2958561fab3dd5cb` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:5e5864df08f423585fd748a908d8756fd26e34a0e8b39a25d2e1e22b151d6184` |
| `GAP_NORMALIZATION` | `sha256:b97fa9e3509c46829edc4bb8ffe8a097827f7b51ec0cb05912e4bd6053a9ed45` |
| `SCOPE_NEGATIVE_CASES` | `sha256:f5022fbb20cdd964e35e5ea6246f62d631ed8cccadbd582e095bf60620547220` |
| `FOCUSED_TEST_EXECUTION` | `sha256:255d950169a1eb43d0b1e61355cecb8fd52885a5b62700fc2958561fab3dd5cb` |
| `PROVENANCE_REPORT` | `sha256:632a47aa8027930021157198bded43c061da464faf16e43b48c8094542728427` |

Input-set hash: `sha256:e1d0c25ea1b8b6a1a7e2ad01738880c5f87074ff73fb312ccb4a88e6a261da25`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
