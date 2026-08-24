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
- [x] W02 Northbound contract freeze
- [x] W03 Workspace, CI, and boundary scan
- [x] W04 PostgreSQL jobs, idempotency, lease, cancel, replay
- [x] W05 GOWM Gateway client
- [x] W06 Deterministic parser
- [x] W07 OpenAI-compatible semantic model adapter
- [x] W08 Semantic frame and grounding graph
- [x] W09 Reference grounding
- [x] W10 Typed query compiler
- [x] W11 Evidence normalization
- [x] W12 Operational products
- [x] W13 Prior grounding and bounded context
- [x] W14 Northbound API
- [x] W15 Security and resilience
- [x] W16 Real integration acceptance (blocked: external model/GOWM environment absent)
- [ ] W17 Final candidate

## Decisions

- Use Node.js 22, npm workspaces, ESM, strict TypeScript, AJV 2020-12, Vitest, PostgreSQL, HTTP/JSON, and Pino.
- Keep the extracted task package local and ignored; copy only normative deliverables into repository-owned paths.
- Record acceptance as `PASS`, `FAIL`, `NOT_RUN`, or `BLOCKED`; static or fixture checks never satisfy real gates.

## Discoveries

- GitHub repository push credentials work through Git credential management, while the current `gh` CLI token is invalid.
- Draft PR creation nevertheless succeeded through the approved `gh pr create` operation: PR #1.
- Docker access requires the approved host boundary; the W04 PostgreSQL 17.10 acceptance run proved the engine and database path usable there.

## Failed attempts retained

- Initial Git Bash preflight selected the non-executable Microsoft Store `python3` alias. A local ignored shim to Python 3.12 was used and the unmodified preflight then passed.
- Initial local Git index write was denied by the workspace sandbox; approved Git write access was used.
- The package intake script's partial clone failed to materialize several promised blobs. A read-only local exact-commit archive was used instead; the first archive inherited CRLF conversion, so it was rerun with `core.autocrlf=false` and passed exact Git-blob and SHA-256 validation.
- The first PostgreSQL integration run sent a NUL-delimited advisory-lock key through the text protocol and failed all four cases. The store now hashes scope/key locally and sends a signed 64-bit advisory key; expanded real-DB acceptance passes.
- The first W06 package-lock-only update was sandbox-blocked from the npm registry and returned EACCES; the approved network retry completed with zero reported vulnerabilities.

## Actual validation

- `python scripts/validate_task_package.py .` -> `TASK_PACKAGE_VALID schemas=19 examples=12 acceptance=206 required_gowm_ops=28`
- `bash scripts/preflight.sh .` with the local Python shim -> `PREFLIGHT_PASS`
- Bootstrap `main` pushed at `ae077ec`.
- Exact GOWM intake verifier -> 33 byte-locked artifacts, 4 required providers, and 28 required operations pass.
- WSGS northbound freeze -> 19 valid JSON Schemas, 11 valid request examples, 1 NO_DATA normalization example, forbidden/unknown-field rejection, and 32 locked artifacts pass.
- Root `npm run check` -> contract byte locks, six generated contract types, architecture boundaries, 11 strict TypeScript projects, and Vitest pass on Node 22.
- Real PostgreSQL 17.10 W04 run -> fresh migration/assertions, 11 tables, idempotency replay/conflict, concurrent claim, lease reclaim/heartbeat, cancel precedence, terminal monotonicity, scope isolation, retention, and restart replay pass.
- W05 Gateway client contract suite -> 12/12 tests pass for locked catalog/operation enforcement, fixed routes, transport-only authority, trace/deadline/abort, retry policy, bounded output, async polling/cancel/receipt, and circuit recovery.
- W06 deterministic parser -> 9/9 tests pass for supplied references/map selections, conservative H3/coordinate/focus/code parsing, exact Chinese/emoji UTF-16 spans, deterministic overlap precedence, prior pointers, and no fabricated ReferenceKey.
- W07 semantic model adapter -> 12/12 strict-output/null normalization, injection isolation, exact-span rejection, bounded repair/retry, abort, hash-only receipt, compatibility-mode, and explicit-unavailable tests pass; real model remains not run because no `MODEL_*` environment is configured.
- W08 frame/graph core -> 12/12 semantic invariant, priority merge, visible conflict/namespace ambiguity, no-hidden-fact, graph limit/integrity, canonical hash, and explicit degraded-Partial tests pass.
- W09 reference grounding -> 8/8 locked resolve/validate, status/score/version preservation, ambiguity/no-data, limits, stale validation, async, authority-drift, and deadline tests pass; real catalog/scope cases remain deferred.
- W10 typed compiler -> 13/13 approved-rule mapping, H3 approximation/exact verification, no-substitution gap, lock/provider/schema/port/unit validation, aggregate budget, public-plan exclusion, and canonical hash tests pass.
- W11 evidence normalization -> 8/8 receipt/evidence separation, status preservation, GOWM authority/schema/snapshots, bounded large-payload summary, model exclusion, drift, and upstream-failed tests pass.
- W12 operational products -> 6/6 four-dimension/no-promotion, correlation/no-match, predicate evidence, timeline stability, optional gap, opaque external authority, and no-mutation tests pass.
- W13 context/prior grounding -> 7/7 same-scope server-load/hash, substitution/history/size rejection, TTL, selected product, and Map revision tests pass; retained-audit real-DB case is added for W16.
- W14 northbound API -> 8/8 authenticated route, frozen request/response/error schema, trusted identity, sync/async, poll/cancel, fail-closed backend, and low-cardinality metrics tests pass; real E2E remains W16.
- W15 security/resilience -> 17/17 Unicode, size, rate, inert input, redaction, signed cursor, bounded queue, and graceful shutdown tests plus 9/9 real PostgreSQL restart/scope/cancel-race/retention tests pass.
- W16 environment audit -> real PostgreSQL 17.10 passed 9/9; real model, GOWM Gateway/provider, and northbound E2E are BLOCKED because all required external configuration is absent.

## Remaining work

Execute W01-W17 in order, create per-phase reports and evidence, and leave merge/tag/release/deploy unperformed.
