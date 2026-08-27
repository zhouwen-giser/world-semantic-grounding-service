# W09 Completion Report

## Phase

W09 — Capability Matcher and Compiler v2. Decision: `BLOCKED`.

## Source state

Matcher, recipes, compiler, typed ports, budgets, snapshot policy, and canonical plan hashing are implemented.

## Scope completed

Component tests cover maturity, availability, domain/relation/reference/spatial/time/result semantics, schema/port/unit matching, ambiguity, no substitution, cycles, weighted budgets, preview opt-in, and deterministic plan hashes.

## Contracts/migrations

Compiler fixtures validate the GOWM lock, schemas, ports, target paths, and snapshot declarations. Production-module tests also prove that requirement-graph inputs and dependencies reach the compiler with typed bindings.

## Tests actually run

| command | result | evidence |
|---|---|---|
| current full no-DB Vitest run | matcher/compiler and production-module tests PASS | `reports/wsgs-v0.2/verification-summary.json` |
| focused compiler/worker run | 5 files, 65 tests PASS | `packages/query-compiler/src/compiler.test.ts`, `packages/query-compiler/src/matcher.test.ts`, `services/grounding-worker/src/production-module.test.ts`, `services/grounding-worker/src/pipeline-policy.test.ts`, `services/grounding-worker/src/result-schema.test.ts` |

## Acceptance cases

See `w09-acceptance.json`: 20 PASS and 8 BLOCKED.

## Security/authority review

Experimental operations are never selected; preview is opt-in; ties without frozen priority return a gap; candidate-only outputs require exact verification.

## Failed attempts retained

The earlier production-input audit gap was repaired in implementation commit `72b911ed9fc453d7c1d736ab551957e4ff4b8850`. This establishes tested production input and port wiring, not trusted live recipe execution.

## Commit/push/PR

Implementation commit `72b911ed9fc453d7c1d736ab551957e4ff4b8850` and deployment commit `9cf1f897cfc400c61c434fe1b34b31ab7f59c99b` exist locally. No commit or push was performed by this reporting calibration.

## Blockers

Signed availability and gate-authored World Query execution are trusted, but no real run proves that the WSGS planner/compiler output executes every required stable recipe through the production pipeline.

## Next phase

Execute actual WSGS-compiled stable recipes against the signed trusted Sample World snapshot through the production worker.
