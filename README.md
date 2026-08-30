# World Semantic Grounding Service

World Semantic Grounding Service (WSGS) grounds bounded world references and compiles typed queries for the GOWM World Capability Gateway.

This repository contains the WSGS 0.2.1 development candidate. It preserves the byte-locked `sacs-wsgs-grounding/1.0` northbound contract and adds the separate `sacs-wsgs-grounding/1.1` geospatial profile. The wire envelope remains `schemaVersion: "1.0"`; the additive profile uses the optional top-level `geospatialFindings` result extension.

Candidate status: **DEVELOPMENT_IN_PROGRESS / PRODUCTION_NOT_QUALIFIED**. Historical v0.2 Development Ready evidence remains available but does not qualify the v0.2.1 consumer handoff. Development completion requires the current v0.2.1 acceptance ledgers, authoritative handoff, PostgreSQL recovery evidence, and the full real SACS v0.4 case set; source or documentation alone is not runtime evidence.

The container surface builds one `wsgs:0.2.1` image and runs it as separate non-root, read-only API and worker services behind a checksum-verified PostgreSQL migration job. Only the API binds a loopback host port. Copy `.env.example` to `.env`, replace every placeholder without committing secrets, and follow the startup and readiness procedure in the runbook.

See [the v0.2.1 SACS geospatial handoff plan](execplans/EP-wsgs-v0.2.1-sacs-geospatial-handoff.md), [the historical v0.2 Development Ready report](reports/wsgs-v0.2/development-ready-report.md), [the runbook](docs/runbook.md), [security and authority notes](docs/security.md), and current phase evidence under `reports/sacs-geospatial-v1/`.
