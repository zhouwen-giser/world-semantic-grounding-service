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

Additional recovery component coverage exercises the production Worker adapter
with real AES-GCM request decoding and scripted SQL. It checks restored 1.2
selection/semantic fields, two generations, stale completion, cancellation,
deadline expiry and legacy/malformed metadata. The settlement lock query now
also obtains `deadline_expired` from PostgreSQL's clock and rejects settlement
after expiry. Previously it relied only on the Worker timer/deadline sweep,
leaving a late-write window. No schema change is needed for this correction.
The component test still does not execute PostgreSQL locking or its clock.

Current development closure is recorded in `closure-review.json`: fresh named
recovery/late-completion tests and real production-path HTTP with server-owned
multi-round authority now pass. Real PostgreSQL transaction, lock, clock and
crash-durability verification remains NOT_RUN and is not inferred from them.
