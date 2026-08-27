# W06 Completion Report

## Phase

W06 — Reference Runtime. Decision: `BLOCKED`.

## Source state

Reference normalizers and prior validators are implemented in the candidate working tree.

## Scope completed

Component logic preserves suggested-unique and ambiguous states, candidate order, match/state confidence separation, NO_DATA, stale/expired validation, exact prior bytes/hash, scope hiding, and missing-product rejection.

## Contracts/migrations

Reference operations use locked operation/schema evidence without provider identity. Prior input contains only grounding ID, result hash, and selected product IDs.

## Tests actually run

| command/gate | result | evidence |
|---|---|---|
| current full no-DB Vitest run | reference/prior component tests PASS | `packages/grounding-graph/src/reference-grounding.test.ts`, `packages/prior-grounding/src/validator.test.ts` |
| real GOWM business gate | several reference observations diagnostic-only | `reports/wsgs-v0.2/real-gowm-gate.json` |

## Acceptance cases

See `w06-acceptance.json`: 5 PASS, 14 BLOCKED, and 1 NOT_RUN.

## Security/authority review

Cross-scope prior records are hidden behind the same not-found boundary; caller-provided historical bodies are rejected.

## Failed attempts retained

Live `2号车` and `滨河路` observations cannot become trusted acceptance while semantic authority is mismatched.

## Commit/push/PR

No commit or push was performed by this reporting pass.

## Blockers

The production resolve/validate chain has not run under trusted readiness. PINNED historical result/reference validation is not available in the locked operation support.

## Next phase

Obtain compatible trusted snapshot support and rerun unique, ambiguity, negative validation, and prior replay scenarios.
