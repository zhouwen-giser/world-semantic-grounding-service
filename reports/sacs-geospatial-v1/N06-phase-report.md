# N06 Source Currentness Phase Report

Status: **SOURCE_AND_UNIT_READY_RUNTIME_NOT_RUN**

- Added the dedicated `VALIDATE_SOURCE_CURRENTNESS` northbound operation and API route.
- Uses the eight-stage Requirement/Capability/Compile/Gateway pipeline with no model stages.
- Locks `geo-product.check-current@1.0` to the exact Provider recipe and hashes.
- CURRENT, CHANGED, NOT_AVAILABLE, and UNKNOWN deterministic source vectors pass.
- STRICT_REUSE fails closed; BEST_EFFORT requires a new query.
- Real Gateway, PostgreSQL, foreign-scope, replay, and restart qualification remain NOT_RUN.
- Completion marker `WSGS_V021_CURRENTNESS_READY` is intentionally withheld.

Input set: `sha256:17f9e679e0f539f382ba8c23f842f66e50ea868dc96ea36d1b56f7814a8b78b0`
