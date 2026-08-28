# W05 Completion Report

## Phase

W05 — Context, Parser, Model, and Graph. Decision: `PASS` for this phase only.

## Source state

Parser/model/graph changes are present in the candidate working tree; overall candidate readiness remains blocked by later phases.

## Scope completed

Deterministic aliases, map selections, ReferenceKey literals, H3, coordinates, bounded codes, geometry focus spans, integer-millimetre distances, ISO times, UTF-16 spans, model policy, and internal graph nodes are implemented with explicit precedence and ambiguity.

## Contracts/migrations

The model is restricted to the frozen WorldSemanticFrame schema and cannot select an operation/provider/tool, mint a ReferenceKey, or assert evidence.

## Tests actually run

| command/gate | result | evidence |
|---|---|---|
| current full no-DB Vitest run | parser/model-policy/frame/graph tests PASS | `reports/wsgs-v0.2/verification-summary.json` |
| real model gate, repeated three times | four cases PASS each run | `reports/wsgs-v0.2/real-model-gate.json` |

The real cases cover `2号车`, `滨河路`, `A区`, and a prompt-injection prefix. Each run retained schema, UTF-16, and authority evidence.

## Acceptance cases

AC-M001 through AC-M022 pass. This does not prove a complete real GOWM pipeline.

## Security/authority review

Prompt text remains inert data. Model receipts remain model provenance, not world evidence.

## Failed attempts retained

Earlier model timeouts and invalid-schema/span attempts remain recorded in the real-model evidence summary rather than being hidden.

## Commit/push/PR

No commit or push was performed by this reporting pass.

## Blockers

None inside the W05 acceptance tranche. Candidate-level GOWM and production-chain blockers remain.

## Next phase

Use these bounded outputs only after a trusted admission snapshot is available.
