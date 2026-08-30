# WSGS GOWM 0.6.4 runtime alignment

## Source and contract tuple

- WSGS implementation base: `c2a71a0f455c728ae45d70067f223e1450cfa427`.
- Qualified WSGS source head: `b3315cbb5dce9635911a90ac095b93b1efab8e70`; later commits contain the completion-audit verifier, generated evidence, and the merge from current `main` without changing the qualified runtime source.
- PR delivery head: verified after push against the live Draft PR metadata; it is intentionally not embedded in the same commit that defines this body, avoiding a Git self-reference.
- Exact GOWM source: `fceed92398a0b86c0a0121aa2188a7f1d328e577`, superseding the original task-package source only under the user's explicit authorization.
- Version invariant: `runtime=0.6.4 / Gateway contract=0.6.3` with consumer package `@gowm/world-gateway-contracts@0.6.3`.
- Northbound remains `sacs-wsgs-grounding/1.0`.

## Machine gates and contract diff

- Machine invariant / negative gate: PASS; runtime and contract versions remain independently locked and fail closed on mutation or authority conflicts.
- Contract intake: manifest 62/62, archive 64/64 byte-identical, and all 25 exact-source checks PASS.
- Contract diff: 120 operations; wire schema and operation policy are stable.
- Observed semantic migrations exactly match the declared allowlist: `world.get-geometry@1.0`, `spatial.find-intersections@1.0`, and `predicate.evaluate@1.0`.
- Single upstream authority and generated compatibility projections are verified.

## Real runtime outcome

- Direct R1-R5: 5/5 PASS against the exact isolated GOWM runtime.
- Formal WSGS pipeline R1-R5: 5/5 PASS through API, PostgreSQL queue, worker, pipeline, signed Gateway execution, normalization, persistence, and retrieval.
- The resolver ReferenceKey is consumed without rewrite through validation, geometry, spatial execution, and persisted-result layers.
- Ambiguity remains fail-closed with two candidates and zero downstream world or spatial execution.
- SACS development handoff is refreshed with `alignmentValidatedRecipes=[R1,R2,R3,R4,R5]` and `productionQualified=false`.
- The deterministic alignment ledger records 24/24 blocking criteria PASS.
- Six deterministic ledger hashes are refreshed for the development ledger, alignment lock, contract diff, reference identity, Formal R1-R5, and SACS handoff; the closure declares each hash algorithm.

## Evidence

- `reports/wsgs-gowm-0.6.4-alignment/alignment-invariant-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/negative-cases-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/contract-intake-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/contract-diff-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/semantic-migration-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/w00-existing-authorities.json`
- `reports/wsgs-gowm-0.6.4-alignment/reference-identity-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/reference-negative-cases.json`
- `reports/wsgs-gowm-0.6.4-alignment/direct-r1-r5-smoke.json`
- `reports/wsgs-gowm-0.6.4-alignment/runtime-binding-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/formal-pipeline-r1-r5.json`
- `reports/wsgs-gowm-0.6.4-alignment/wsgs-process-binding.json`
- `reports/wsgs-gowm-0.6.4-alignment/wsgs-runtime-image-build-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/reference-composability-r3.json`
- `reports/wsgs-gowm-0.6.4-alignment/pipeline-traceability.json`
- `reports/wsgs-gowm-0.6.4-alignment/handoff-verification-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/alignment-ledger.json`
- `reports/wsgs-gowm-0.6.4-alignment/closure-report.json`

## Deferred capabilities

The following remain explicitly deferred and are not promoted by this alignment slice:

- `EXACT_HISTORICAL_PINNED_REPLAY`
- `FULL_REAL_DELEGATION_NEGATIVE_MATRIX`
- `OBJECT_STORAGE_INFRASTRUCTURE`
- `PRODUCTION_RESTART_MATRIX`
- `HA_DR_SLO_AND_LOAD_QUALIFICATION`

## Boundaries

Development readiness only. This does not claim production qualification, release, deployment, or shared-runtime mutation.

No merge, tag, release, deployment, or production qualification is performed by this pull request.
