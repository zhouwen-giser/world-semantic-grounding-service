# World Semantic Grounding Service

World Semantic Grounding Service (WSGS) grounds bounded world references and compiles typed queries for the GOWM World Capability Gateway.

The released baseline remains version 0.1.0 with the frozen `sacs-wsgs-grounding/1.0` northbound contract. The `codex/wsgs-v0.2-gowm-0.6.3-integration` candidate is now integrating the locked GOWM+ 0.6.3 consumer artifact, signed delegation, a PostgreSQL-backed worker pipeline, semantic requirement planning, capability matching, and typed query compilation without changing that public wire contract.

Candidate status: **IN PROGRESS**. The exact WSGS 0.1.0 baseline and its real PostgreSQL regression suite pass. WSGS 0.2.0 runtime, real model/GOWM qualification, recovery gates, and the complete 279-case acceptance ledger remain required before the candidate can be called stable or made Ready for Review.

See [the v0.2 execution plan](execplans/EP-wsgs-v0.2-gowm-063.md), [the runbook](docs/runbook.md), [security and authority notes](docs/security.md), and phase evidence under `reports/wsgs-v0.2/`.
