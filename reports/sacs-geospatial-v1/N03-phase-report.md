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
| Focused execution evidence bound to current input set | PASS; `sha256:0d2bbf76e8c2028713f808665efcc0e3a3f78fc786c0bc1df818e5ce8fb3ff41` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:422ba33585c046952b1428963c8e173a5b4362196cafa966fff2967b08dcceaa` |
| `GAP_NORMALIZATION` | `sha256:369483946e7f307989b225a114cef1b97a9cab6b1deaa102b1f35eb99ab6d0a4` |
| `SCOPE_NEGATIVE_CASES` | `sha256:3b84a11ffa3f575e7ae6bcc572db0c2dee4d66dd3919ca9a5eddef49190df2db` |
| `FOCUSED_TEST_EXECUTION` | `sha256:0d2bbf76e8c2028713f808665efcc0e3a3f78fc786c0bc1df818e5ce8fb3ff41` |
| `PROVENANCE_REPORT` | `sha256:f299406e4ff517c397b1632af411cc93fda3138dfbee4cc622b88bc2431de5c2` |

Input-set hash: `sha256:80647ab0c011966393ec966e3aaf34b89224f5ede95cc478cd67d4dc78a288da`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
