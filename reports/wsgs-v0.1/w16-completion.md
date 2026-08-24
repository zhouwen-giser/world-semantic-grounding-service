# W16 Real Integration Acceptance Report

## Outcome

W16 is **BLOCKED** for real GOWM Gateway/provider and semantic-model E2E. Real PostgreSQL 17.10 acceptance passed. No mock, injected backend, constructed result, or static contract test is counted as external real evidence.

## Environment audit

Only variable presence was inspected; no secret value was read or printed.

| required input | present |
|---|---|
| `MODEL_BASE_URL` | no |
| `MODEL_API_KEY` | no |
| `MODEL_ID` | no |
| `MODEL_MODE` | no |
| `MODEL_TIMEOUT_MS` | no |
| `MODEL_MAX_RETRIES` | no |
| `GOWM_GATEWAY_BASE_URL` | no |
| `GOWM_GATEWAY_TOKEN` | no |
| `GOWM_DATA_SCOPE` | no |
| ambient `TEST_DATABASE_URL` | no; an isolated test database was explicitly supplied for the run |

## Tests actually run

| command | result | evidence |
|---|---|---|
| PostgreSQL 17.10 durable suite | PASS | 9/9 migration/assertion, idempotency, claim, reclaim, cancel race, scope, retention, restart replay, terminal monotonicity |
| real OpenAI-compatible model | BLOCKED | model endpoint, key, model ID, mode, timeout, and retry configuration absent |
| real GOWM Gateway/provider | BLOCKED | Gateway endpoint, credential, deployment data scope, and provider dataset absent |
| real northbound sync/async/poll/cancel | BLOCKED | no real Gateway/model composition can reach a terminal grounding result |

## Acceptance classification

- PASS: AC-P008 (retained audit result survives source expiry and is cross-scope invisible on real PostgreSQL).
- PASS evidence retained: AC-S004, AC-S016, and the PostgreSQL portions of recovery/retention gates.
- BLOCKED: AC-U010; AC-J009..AC-J012; AC-G001, AC-G002, AC-G005..AC-G008, AC-G016; AC-D003; AC-M001; AC-F001..AC-F004; AC-R001..AC-R003, AC-R009..AC-R012; AC-Q001..AC-Q005, AC-Q008..AC-Q010; AC-E002..AC-E004; AC-O001..AC-O010; AC-P003, AC-P004, AC-P007; AC-S019..AC-S024; AC-FN001, AC-FN002.
- NOT_RUN: AC-J002. There is no prior WSGS schema version to upgrade in this empty-repository v0.1 bootstrap.
- Other non-real contract/unit/security gates retain their earlier status.

## External-service blockers

1. No real OpenAI-compatible semantic-model configuration is available.
2. No locked GOWM 0.4.0 Gateway endpoint, credential, deployment data scope, or provider dataset is available.
3. Because both authorities are absent, a real SACS-shaped northbound request cannot be driven through to a real terminal result.

The earlier constructed `UNRESOLVED` reference case remains useful component evidence, but AC-R012 is corrected to BLOCKED because its matrix type is `real-e2e`.

## Protected actions

No merge, tag, release, or deploy was performed. Draft PR #1 remains the delivery vehicle.

## Next phase

W17 produces the 0.1.0 blocked-candidate documentation, deployment artifacts, complete acceptance ledger, exact SHA/PR evidence, and the required blocked completion marker.
