# World Semantic Grounding Service

World Semantic Grounding Service (WSGS) grounds bounded world references and compiles typed queries for the GOWM World Capability Gateway.

This repository contains the WSGS 0.2.0 integration candidate. It retains the frozen `sacs-wsgs-grounding/1.0` northbound wire contract, including the public capabilities response values `version: 0.1.0` and GOWM `softwareVersion: 0.4.0`. The candidate's internal execution authority is separately locked to the exact GOWM+ 0.6.3 consumer artifact.

Candidate status: **DEVELOPMENT_READY / PRODUCTION_NOT_QUALIFIED**. The separate development profile is 63/63 PASS. A real public request traversed PostgreSQL, the production worker, a real semantic model, the WSGS planner/compiler, signed GOWM execution, normalization, persistence, and public retrieval; all six minimum stable recipes passed. The historical 279-case ledger is preserved separately. Direct-operation `202`, exact historical `PINNED` replay, production restart matrices, HA/DR/SLO/load, and object-storage qualification remain deferred and must not be represented as production readiness.

The container surface builds one `wsgs:0.2.0` image and runs it as separate non-root, read-only API and worker services behind a checksum-verified PostgreSQL migration job. Only the API binds a loopback host port. Copy `.env.example` to `.env`, replace every placeholder without committing secrets, and follow the startup and readiness procedure in the runbook.

See [the v0.2 execution plan](execplans/EP-wsgs-v0.2-gowm-063.md), [the Development Ready report](reports/wsgs-v0.2/development-ready-report.md), [the runbook](docs/runbook.md), [security and authority notes](docs/security.md), and phase evidence under `reports/wsgs-v0.2/`.
