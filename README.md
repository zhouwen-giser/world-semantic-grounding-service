# World Semantic Grounding Service

World Semantic Grounding Service (WSGS) grounds bounded world references and compiles typed queries for the GOWM World Capability Gateway.

This repository contains the WSGS 0.2.0 integration candidate. It retains the frozen `sacs-wsgs-grounding/1.0` northbound wire contract, including the public capabilities response values `version: 0.1.0` and GOWM `softwareVersion: 0.4.0`. The candidate's internal execution authority is separately locked to the exact GOWM+ 0.6.3 consumer artifact.

Candidate status: **BLOCKED**. Repeated real semantic-model runs passed the bounded schema, UTF-16 span, and authority checks. The GOWM+ Sample World public discovery and semantic-catalog checks now match the explicitly pinned operational lock, resolving the earlier canonicalization drift for that candidate. Signed availability and execution were not run because secure credential handoff was not authorized; direct-operation `202`, `PINNED` historical validation, and the trusted full production chain therefore remain unproven. WSGS fails closed and must not be described as stable, complete, or ready for production traffic.

The container surface builds one `wsgs:0.2.0` image and runs it as separate non-root, read-only API and worker services behind a checksum-verified PostgreSQL migration job. Only the API binds a loopback host port. Copy `.env.example` to `.env`, replace every placeholder without committing secrets, and follow the startup and readiness procedure in the runbook.

See [the v0.2 execution plan](execplans/EP-wsgs-v0.2-gowm-063.md), [the runbook](docs/runbook.md), [security and authority notes](docs/security.md), and phase evidence under `reports/wsgs-v0.2/`.
