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
| Focused execution evidence bound to current input set | PASS; `sha256:4a140d545b72d866f713ff8d93559180a2bf12d0b63282913a494a96bd2fa11e` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:465e2c6e292a9e83f1786ede6d1826b1becede8856970cc2a276f42edcecc626` |
| `GAP_NORMALIZATION` | `sha256:aba32a55f0d4148dd46be1acc95fb4e97d3a03aca968c7258daff638c548f129` |
| `SCOPE_NEGATIVE_CASES` | `sha256:cefb4246a969b0d45beb5b223fd93bd77fc5c851ba9ed965bb91c4264bd30a77` |
| `FOCUSED_TEST_EXECUTION` | `sha256:4a140d545b72d866f713ff8d93559180a2bf12d0b63282913a494a96bd2fa11e` |
| `PROVENANCE_REPORT` | `sha256:424b7ff0a57dda8709dc7dfdb75eb7dfad534062ef3d2d701c385e4f0cf54afa` |

Input-set hash: `sha256:0ca6d3f0cf2d375926cec740e725debce4bf7ab4518be937f8845d503fd8bf2c`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
