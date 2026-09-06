# W03 Persistence Compatibility

Status: static and scripted-SQL component review only; real PostgreSQL NOT_RUN.

No migration is needed for the current 1.2 transport implementation.
`database/migrations/001_wsgs_core.sql` already stores request metadata in JSONB
and result documents as bytes. No SQL version/profile enumeration constraint
exists in migrations 001 through 004. No historical migration was edited.

The backend saves its server-selected contract in request metadata. The existing
Worker claim path reads that metadata through the expanded strict parser and
places it in initialState. Missing selection remains 1.0. Malformed metadata
fails closed. The result is assembled and hashed before persistence; GET does
not add or transform the component.

The production PostgreSQL adapter is exercised with an explicitly scripted SQL
boundary in `packages/grounding-pipeline/src/postgres-contract-boundary.test.ts`.
This verifies result/job replay, changed-payload rejection, profile isolation,
historical metadata handling and terminal cancellation policy. It does not prove
SQL execution, database locks, transactions, crash recovery or concurrent fencing.
Those scopes must not be inferred from the six component tests.

Remaining: fresh 1.2 recovery/late-completion evidence and production HTTP
integration, plus the independent choice authority required by W04.
