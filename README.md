# World Semantic Grounding Service

World Semantic Grounding Service (WSGS) grounds bounded world references and compiles typed queries for the GOWM World Capability Gateway.

This repository contains the WSGS 0.2.0 integration candidate. It retains the frozen `sacs-wsgs-grounding/1.0` northbound wire contract, including the public capabilities response values `version: 0.1.0` and GOWM `softwareVersion: 0.4.0`. The candidate's internal execution authority is separately locked to the exact GOWM+ 0.6.3 consumer artifact.

Candidate status: **BLOCKED**. Repeated real semantic-model runs passed the bounded schema, UTF-16 span, and authority checks. The current real GOWM+ run records **7 PASS / 2 BLOCKED**: the seven successful observations are diagnostic-only because the published semantic-catalog lock and the live catalog use different canonicalization, and the direct-operation route does not support the required `202` asynchronous response. WSGS therefore fails closed and must not be described as stable, complete, or ready for production traffic.

The container surface builds one `wsgs:0.2.0` image and runs it as separate non-root, read-only API and worker services behind a checksum-verified PostgreSQL migration job. Only the API binds a loopback host port. Copy `.env.example` to `.env`, replace every placeholder without committing secrets, and follow the startup and readiness procedure in the runbook.

See [the v0.2 execution plan](execplans/EP-wsgs-v0.2-gowm-063.md), [the runbook](docs/runbook.md), [security and authority notes](docs/security.md), and phase evidence under `reports/wsgs-v0.2/`.
