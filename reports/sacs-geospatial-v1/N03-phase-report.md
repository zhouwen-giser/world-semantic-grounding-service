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
| Focused execution evidence bound to current input set | PASS; `sha256:051b161d8dd4eaa8ea3a398b991c234669475f45819f8331db5bb34773c253cb` |
| Deterministic N03 materialization guard | PASS |
| Real signed Gateway upstream gate | NOT_RUN |
| Direct Provider / database calls | 0 / 0 |

The focused count is parsed from the actual Vitest JSON result and bound to the current N03 input-set hash; it is not a hard-coded estimate. Check mode validates the stored execution evidence without rerunning unchanged tests.

## Evidence hashes

| Logical artifact | SHA-256 |
|---|---|
| `PROVENANCE_INTEGRITY` | `sha256:bc952151b570ab8d543de7087fcd3c3d64953a944228c355507eab0677dcfee1` |
| `GAP_NORMALIZATION` | `sha256:891af6692d2dfef071ea2ae0c4168854df48f94220a55b99371e689b802a163d` |
| `SCOPE_NEGATIVE_CASES` | `sha256:8425f7b5af74a726027ca5cfac73db6f41386b9cfeb8a52a9354abfb3dde532e` |
| `FOCUSED_TEST_EXECUTION` | `sha256:051b161d8dd4eaa8ea3a398b991c234669475f45819f8331db5bb34773c253cb` |
| `PROVENANCE_REPORT` | `sha256:8a849804c73e4c6cfc54aed3bffa13e84b02f6ec252647412487301cd61153c6` |

Input-set hash: `sha256:1859c832afe68916e6be344a83544957f6b48dff29a18090fc3c053e21a6c41e`.

## Qualification boundary

- V21-G06: NOT_RUN.
- Runtime qualification: NOT_RUN.
- Real SACS v0.4 cases: 0/18.
- Consumer compatible: false.
- G1: NOT_RUN.

No shared instance was modified or restarted. No credential, request identifier, raw reference ID, local path, internal Provider URL, database identifier, asset path, or internal topology is recorded.
