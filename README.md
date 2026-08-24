# World Semantic Grounding Service

World Semantic Grounding Service (WSGS) grounds bounded world references and compiles typed queries for the GOWM World Capability Gateway.

Version 0.1.0 targets GOWM 0.4.0 and the frozen `sacs-wsgs-grounding/1.0` northbound contract.

Candidate status: **BLOCKED**. Contract, component, security, real PostgreSQL, build, and hardened-container gates pass. Real OpenAI-compatible model and GOWM Gateway/provider E2E are blocked because their endpoints, credentials, scope, and datasets were unavailable. The executable image intentionally reports readiness 503 until a production grounding backend is composed and those gates pass.

See [the runbook](docs/runbook.md), [security and authority notes](docs/security.md), and the phase/final evidence under `reports/wsgs-v0.1/`.
