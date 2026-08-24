# GOWM upstream contract policy

WSGS 0.1 consumes only contract artifacts from `zhouwen-giser/geospatial-operational-world-model` at commit `db575f79c874a69f65a2043a7e463338524b713d` (software `0.4.0`). The default branch is never an intake source.

The vendored boundary is limited to GOWM v0.4 schemas/examples/provider manifests, platform schemas/OpenAPI, provider manifests, `VERSION`, and `PROJECT_STATUS.md`. GOWM application packages, services, database objects, and provider implementations are forbidden.

Required capability identity is frozen in `contracts/upstream/required-operation-lock.json`: operation ID/version, provider ID/version, maturity, typed schema file, and schema hash. Runtime catalog drift fails readiness and execution closed. Optional capability absence is reported as a capability gap and does not fail reference-core readiness.

Any GOWM upgrade requires an explicit compatibility change and separate pull request. It must regenerate the byte lock, rerun contract and live-catalog checks, and document schema or behavioral differences. No automated default-branch drift is permitted.

