# EP: WSGS v0.1 Grounding Core

This is a living execution plan for WSGS 0.1.0.

## Purpose

Build an independent service that turns bounded SACS grounding work into neutral semantic frames, grounded references, typed GOWM World Query v2 plans, and normalized evidence without taking over conversation, planning, provider, or world-authority responsibilities.

## Source truth

- Task package: `WSGS_v0.1_Grounding_Core_Codex_Goal` R1, validated on 2026-08-24.
- Northbound schemas and OpenAPI from the task package are normative for `sacs-wsgs-grounding/1.0`.
- The target repository was empty before bootstrap commit `ae077ec`.

## Upstream GOWM lock

- Repository: `zhouwen-giser/geospatial-operational-world-model`
- Commit: `db575f79c874a69f65a2043a7e463338524b713d`
- Software: `0.4.0`
- Source package lock blob: `97b118737f82bfe49c7741b2787da9d72e2d7400`
- Gateway OpenAPI blob: `120f1f3ca2d65f5d7a73422718b6aa152794abed`

## Architecture invariants

- SACS owns conversation intent and orchestration; WSGS returns neutral grounding products.
- GOWM owns reference keys, world facts, operational reality, and evidence.
- WSGS calls only the GOWM World Capability Gateway and never a provider, MCP tool, GOWM database, SDAR, or A2A endpoint.
- Identity and data scope come from trusted transport/deployment context, never the request body.
- Model output is an untrusted semantic frame, never a fact, plan, provider selection, reference key, or evidence.
- Cancellation is durable and terminal; late model or Gateway results cannot overwrite it.
- Mock and fixture results remain clearly separate from real GOWM, PostgreSQL, and model evidence.

## Progress

- [x] W00 Repository bootstrap and execution plan
- [x] W01 GOWM contract intake
- [ ] W02 Northbound contract freeze
- [ ] W03 Workspace, CI, and boundary scan
- [ ] W04 PostgreSQL jobs, idempotency, lease, cancel, replay
- [ ] W05 GOWM Gateway client
- [ ] W06 Deterministic parser
- [ ] W07 OpenAI-compatible semantic model adapter
- [ ] W08 Semantic frame and grounding graph
- [ ] W09 Reference grounding
- [ ] W10 Typed query compiler
- [ ] W11 Evidence normalization
- [ ] W12 Operational products
- [ ] W13 Prior grounding and bounded context
- [ ] W14 Northbound API
- [ ] W15 Security and resilience
- [ ] W16 Real integration acceptance
- [ ] W17 Final candidate

## Decisions

- Use Node.js 22, npm workspaces, ESM, strict TypeScript, AJV 2020-12, Vitest, PostgreSQL, HTTP/JSON, and Pino.
- Keep the extracted task package local and ignored; copy only normative deliverables into repository-owned paths.
- Record acceptance as `PASS`, `FAIL`, `NOT_RUN`, or `BLOCKED`; static or fixture checks never satisfy real gates.

## Discoveries

- GitHub repository push credentials work through Git credential management, while the current `gh` CLI token is invalid.
- Draft PR creation nevertheless succeeded through the approved `gh pr create` operation: PR #1.
- Docker is installed but its config and engine pipe are inaccessible in the current sandbox context.

## Failed attempts retained

- Initial Git Bash preflight selected the non-executable Microsoft Store `python3` alias. A local ignored shim to Python 3.12 was used and the unmodified preflight then passed.
- Initial local Git index write was denied by the workspace sandbox; approved Git write access was used.
- The package intake script's partial clone failed to materialize several promised blobs. A read-only local exact-commit archive was used instead; the first archive inherited CRLF conversion, so it was rerun with `core.autocrlf=false` and passed exact Git-blob and SHA-256 validation.

## Actual validation

- `python scripts/validate_task_package.py .` -> `TASK_PACKAGE_VALID schemas=19 examples=12 acceptance=206 required_gowm_ops=28`
- `bash scripts/preflight.sh .` with the local Python shim -> `PREFLIGHT_PASS`
- Bootstrap `main` pushed at `ae077ec`.
- Exact GOWM intake verifier -> 33 byte-locked artifacts, 4 required providers, and 28 required operations pass.

## Remaining work

Execute W01-W17 in order, create per-phase reports and evidence, and leave merge/tag/release/deploy unperformed.
