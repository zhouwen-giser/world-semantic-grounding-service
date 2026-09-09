# WSGS v0.2.4 Stable World Analysis

## Scope

Development integration of existing historical/GSAP capabilities into the WSGS
public 1.2 result profile, preserving 1.0/1.1 behavior and the T5 baseline.
Five public finding kinds, bounded choices, server-owned multi-round selection,
capability discovery and non-authorizing historical action candidates are included.
No upstream repository implementation, merge, tag, release or deployment.

The branch includes unmerged T5 PR #14. Keep both PRs Draft; do not merge #14
automatically. Main was refreshed and remains 565e527; T5 remains 0db24edf.

## Verification

Tested implementation commit: 14dffed. Final command records are under
`reports/wsgs-v0.2.4-stable-world-analysis-service/W07/`.

- `npm run check`: PASS; 954 tests passed, 29 skipped.
- Independent `npm test`: PASS; 954 tests passed, 29 skipped.
- `npm run build`: PASS.
- `npm run verify:world-analysis-contract`: PASS; 45 schemas, 44 examples,
  836 assertions, 68 unchanged legacy artifacts.
- `npm run smoke:world-analysis:fixture`: PASS; 43 tests.
- `npm run test:world-analysis:http`: PASS; 23 actual local HTTP cases.
- `npm run verify:world-analysis:handoff`: PASS; isolated standalone bundle,
  20 positive and 24 negative full samples, two-round linkage and four damaged
  bundle rejections. Six validator runtime dependencies are explicitly vendored.

## Consumer Delivery

`contracts/consumers/sacs-world-analysis-v1/` is self-contained. Run
`node verify.mjs` from that directory using Node 22 or newer. See its public
README, OpenAPI and semantics for negotiation, stored jobs, selections and cancel.
The offline package is not a live SACS or provider integration acceptance.

## Limits

Real Gateway/providers, PostgreSQL, model, SACS and devices are NOT_RUN.
HTTP exercises production orchestration with controlled Gateway/store dependencies.
Historical candidate coordinates do not authorize execution: current validation,
route planning and execution confirmation remain mandatory. No production,
strict-replay, release or device-execution qualification is claimed.

Final acceptance ledger and MD/JSON reports in the report root record the
development-only completion decision and actual remote-delivery state.
