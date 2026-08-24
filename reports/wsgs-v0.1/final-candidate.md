# WSGS v0.1 Grounding Core Final Candidate

## Decision

`BLOCKED`

## Candidate

Version 0.1.0 on `codex/wsgs-v0.1-grounding-core`, delivered through Draft PR #1. Exact local and remote candidate SHAs are verified after the W17 push.

## GOWM upstream lock

GOWM 0.4.0 commit `db575f79c874a69f65a2043a7e463338524b713d`, 33 source-package artifacts, four provider identities, and 28 operation locks are byte-frozen and pass local verification. Live catalog/schema equality is blocked without the Gateway.

## Northbound contract

Nineteen JSON Schemas, frozen OpenAPI, twelve examples, error/capabilities envelopes, forbidden decision-field scan, and authenticated runtime validation pass. This makes the SACS-facing contract source-ready but not integration-ready.

## Deterministic parsing and semantic model

Deterministic known/map/H3/coordinate/focus parsing and exact UTF-16 spans pass. The strict OpenAI-compatible adapter disables tools, enforces structured output and local validation, bounds retries/deadlines, isolates prompt injection, and records hash-only receipts. Real model acceptance is blocked.

## Frame, grounding, compiler, evidence, and products

Semantic frame/graph invariants, conflict visibility, component reference grounding, fixed typed query compilation, evidence authority preservation, operational product invariants, and bounded prior context pass constructed/unit contract gates. All matrix entries typed `real-e2e` remain blocked where the Gateway/provider/model is absent; constructed results are not promoted.

## Persistence and recovery

PostgreSQL 17.10 passed 9/9 real tests for migrations/assertions, idempotency, concurrency, leases, cancellation/late-result precedence, restart replay, scope isolation, raw-source expiry, retained audit bytes, and terminal monotonicity.

## Security, scope, and privacy

Trusted transport identity, recursive authority-field rejection, JWT audience/permission checks, inert URL/SQL/operation-looking text, request and Unicode limits, scoped rate budgets/cursors, log/error redaction, bounded work, and graceful abort behavior pass.

## Deployment and observability

The digest-pinned Node 22 image builds and runs as UID/GID 10001 with a read-only root filesystem, no new privileges, bounded noexec tmpfs, healthcheck, graceful signals, and low-cardinality metrics. The executable backend fails closed with readiness 503 until the production pipeline is composed and accepted.

## Real GOWM acceptance

Blocked. Gateway URL/token/scope, provider dataset, and all model configuration variables are absent.

## Known qualifications

The required ledger contains 206 cases: 145 PASS, 0 FAIL, 2 NOT_RUN, and 59 BLOCKED. The authoritative detail is `required-acceptance-ledger.json` beside this report.

## Explicitly not performed

- GOWM or any other repository modification
- SACS/SDAR/SMPP/A2A modification
- PR Ready transition
- merge
- tag or release
- production deployment

## Final marker

```text
WSGS_V0_1_GROUNDING_CORE_BLOCKED
```
