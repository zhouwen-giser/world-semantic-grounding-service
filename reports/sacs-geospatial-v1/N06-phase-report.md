# N06 Source Currentness Phase Report

Status: **SOURCE_AND_UNIT_READY_RUNTIME_NOT_RUN**

- Added the dedicated `VALIDATE_SOURCE_CURRENTNESS` northbound operation and API route.
- Uses the eight-stage Requirement/Capability/Compile/Gateway pipeline with no model stages.
- Locks `geo-product.check-current@1.0` to the exact Provider recipe and hashes.
- CURRENT, CHANGED, NOT_AVAILABLE, and UNKNOWN deterministic source vectors pass.
- STRICT_REUSE fails closed; BEST_EFFORT requires a new query.
- Real Gateway, PostgreSQL, foreign-scope, replay, and restart qualification remain NOT_RUN.
- Completion marker `WSGS_V021_CURRENTNESS_READY` is intentionally withheld.

Input set: `sha256:91e87b880f0e6c9ad5f54c19065003cc6d57027877edb9aaa6d5d4075c9df5b1`
