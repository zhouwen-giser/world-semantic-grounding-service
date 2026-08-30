# WSGS GOWM 0.6.4 runtime alignment

## Outcome

- Re-locks the exact GOWM source to `fceed92398a0b86c0a0121aa2188a7f1d328e577` while retaining the frozen Gateway contract package at 0.6.3.
- Direct and Formal R1-R5 both pass 5/5 against exact isolated GOWM and WSGS images.
- Preserves the complete resolver ReferenceKey through validation, planning, Gateway resolver, and persisted-result layers, while separately proving object identity for authoritative world-fact version projection.
- Keeps ambiguity fail-closed with two candidates and no downstream world or spatial execution.

## Evidence

- `reports/wsgs-gowm-0.6.4-alignment/direct-r1-r5-smoke.json`
- `reports/wsgs-gowm-0.6.4-alignment/runtime-binding-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/runtime-image-build-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/formal-pipeline-r1-r5.json`
- `reports/wsgs-gowm-0.6.4-alignment/wsgs-process-binding.json`
- `reports/wsgs-gowm-0.6.4-alignment/wsgs-runtime-image-build-report.json`
- `reports/wsgs-gowm-0.6.4-alignment/pipeline-traceability.json`
- `reports/wsgs-gowm-0.6.4-alignment/closure-report.json`

## Boundaries

Development readiness only. This does not claim production qualification, release, deployment, or shared-runtime mutation.

No merge, tag, release, deployment, or production qualification is performed by this pull request.
