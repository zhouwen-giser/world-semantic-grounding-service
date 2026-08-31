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
| Focused execution evidence bound to current input set | PASS; `sha256:90c17fc57a12e55e2de08aeb10883c8d709133aa17f60d4194a27e35389898a7` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:49a0389709783ea4c02b8a29208fbe4f50f2128d17907d21f60c42068d81944f` |
| `GAP_NORMALIZATION` | `sha256:0e91709871566dcebd971abf6440359e9769e1c49982336484be2ffa5785cac7` |
| `SCOPE_NEGATIVE_CASES` | `sha256:d6472ccf5ab724e01f5b953cb81637cac056600a360677dd31b0d489eb67e13f` |
| `FOCUSED_TEST_EXECUTION` | `sha256:90c17fc57a12e55e2de08aeb10883c8d709133aa17f60d4194a27e35389898a7` |
| `PROVENANCE_REPORT` | `sha256:3dda4f84b65797f6aa5e27a454380a1f11823b1f008b8152fa0cb3b396975338` |

Input-set hash: `sha256:ceb63771b7621b47699d727eb8ea7776d8f23734278b0b8b01f2d0ab24e21834`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
