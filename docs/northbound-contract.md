# SACS to WSGS grounding contract

Contract version `sacs-wsgs-grounding/1.0` accepts caller-selected service work through `GroundingRequest.operation`: `GROUND_REFERENCES`, `COMPILE_WORLD_QUERY`, `EXECUTE_WORLD_QUERY`, or `VALIDATE_REFERENCES`. This operation is not inferred user intent and does not authorize WSGS to decide whether to answer, route, forward, or create a task.

The caller supplies one bounded source message, requested neutral products, a bounded context capsule, and a read-only execution policy. Authentication, actor identity, permissions, and data scope are transport-derived and are not legal body fields.

WSGS returns neutral grounding products: mentions, semantic frame, grounding graph, reference products, evidence items, ambiguities, unknowns, capability gaps, query execution summaries, warnings, and typed errors. Decision fields such as `intent`, `route`, `shouldAnswer`, `shouldForwardToSdar`, `shouldCreateTask`, and `operationalBindings` are forbidden.

`VALIDATE_REFERENCES` preserves fail-closed upstream validity. A reference is reusable only when the locked GOWM validation result says it is currently usable; WSGS then returns `sourceOperation=VALIDATE_REFERENCES`, `revalidationRequired=false`, and a bounded `validUntil` lease derived from the authoritative validation snapshot time. The lease defaults to 60 seconds and may be bounded from 1 through 300 seconds with `WSGS_REFERENCE_VALIDATION_TTL_MS`. Stale, expired, missing, or scope-denied references receive no refreshed lease.

All textual spans use UTF-16 code-unit offsets with inclusive `start` and exclusive `end`. Runtime validation must prove that each `surfaceText` equals the exact source slice at those offsets.

The frozen HTTP surface is:

- `GET /health/live`
- `GET /health/ready`
- `GET /v1/capabilities`
- `POST /v1/groundings`
- `GET /v1/groundings/{groundingId}`
- `POST /v1/groundings/{groundingId}:cancel`

All public errors use the typed protocol error envelope and must be redacted before leaving the service boundary.

