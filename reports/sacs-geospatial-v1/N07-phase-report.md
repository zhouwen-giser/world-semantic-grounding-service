# N07 PostgreSQL Persistence Phase Report

Status: **SOURCE_READY_POSTGRES_AND_RESTART_NOT_RUN**

- Added additive migration 005 and matching SQL assertions.
- The existing grounding result bytes remain the single full-result authority.
- Contract, geospatial hash/lock, structured selection, and currentness state are written with authority bindings.
- Currentness result settlement now validates its dedicated schema and hash field.
- Result and currentness extension writes share the fenced Worker settlement transaction.
- Structured selection revisions use a PostgreSQL advisory transaction lock and persist token metadata only.
- Real PostgreSQL migration, restart, replay, and negative cases remain NOT_RUN.
- Completion marker `WSGS_V021_PERSISTENCE_READY` is intentionally withheld.

Input set: `sha256:0392864b5b57dbd2f2aee5cf2731144eea9ee15beb6679872e81bbb1c2d583a2`
