# EP: WSGS v0.2 GOWM 0.6.3 Integration

This is the living execution plan for WSGS 0.2.0.

## Source truth

- Task package: `WSGS_GOWM_0.6.3_Integration_v0.2_Codex_Goal` R1, generated and validated on 2026-08-27.
- WSGS baseline: `zhouwen-giser/world-semantic-grounding-service@2fdefe3769189fa8e8be4302a9e98ca55cf686d4`, version 0.1.0.
- GOWM+ source: `zhouwen-giser/geospatial-operational-world-model@17dd221330d9af540ec815a39eca96550690299a`, version 0.6.3.
- Both fetched `origin/main` refs equal the locked commits; there was no forward drift at W00.
- GOWM consumer contracts are materialized only from exact-commit Git blobs or an independently verified operator artifact, never from an unpinned branch.

## Authority boundaries

- SACS owns conversation, intent, user disambiguation, call routing, and the final answer.
- WSGS owns semantic parsing, grounding graphs, reference grounding orchestration, neutral requirements, typed query compilation, and evidence normalization.
- GOWM+ owns world references, facts, events, snapshots, evidence, products, capability semantics, and operation availability.
- SDAR owns planning tasks; WSGS has no SDAR or A2A dependency.
- WSGS calls only `GOWM_GATEWAY_BASE_URL`. Provider URLs, provider databases, MCP discovery, and provider identity are never runtime authorities.

## Northbound compatibility

- `contracts/wsgs-v0.1` remains byte-identical and authoritative for `sacs-wsgs-grounding/1.0`.
- Public operations remain `GROUND_REFERENCES`, `COMPILE_WORLD_QUERY`, `EXECUTE_WORLD_QUERY`, and `VALIDATE_REFERENCES`.
- WSGS 0.2 additions live in internal contracts and runtime metadata. They do not rewrite the frozen 0.1 capabilities response, whose historical GOWM 0.4.0 compatibility claim is preserved only as wire-contract history.

## Progress

- [x] W00 Baseline reconciliation and Draft PR
- [x] W01 GOWM 0.6.3 consumer contract intake
- [x] W02 Gateway client v2
- [x] W03 Delegated identity
- [x] W04 Production backend, worker, and pipeline
- [x] W05 Context, parser, model policy, and graph
- [x] W06 Reference runtime
- [x] W07 Trusted capability snapshot
- [x] W08 Semantic requirement planner
- [x] W09 Capability matcher and compiler v2
- [x] W10 GOWM execution and evidence
- [x] W11 Prior grounding revalidation
- [x] W12 API, readiness, security, and recovery
- [ ] W13 Real model, GOWM, and PostgreSQL E2E
- [ ] W14 Stable candidate

## Decisions

- Keep the supplied task package outside the candidate tree; copy only normative contracts, manifests, examples, and acceptance data into repository-owned paths.
- Preserve truthful `PASS`, `FAIL`, `NOT_RUN`, and `BLOCKED` evidence. Fixture or mock results never satisfy real model, GOWM, PostgreSQL, or multi-process gates.
- Interpret the GOWM `packageIntegrity` field exactly as its 0.6.3 build defines it: SHA-512 over canonical pre-lock bundle file records. Record the npm tarball byte hashes separately because the logical integrity is not the tarball digest.
- Verify Git-blob bytes and bundle MANIFEST records with LF-stable materialization. The Windows checkout has `core.autocrlf=true`, so working-tree bytes are not supply-chain evidence.
- Send `LATEST_AT_START` explicitly because an omitted GOWM query snapshot policy defaults to best effort.
- Treat W07-W09 and W10-W11 acceptance allocations as shared ranges because the task package does not define a finer machine mapping.

## Discoveries

- The task package validator proves its own 66 listed files, 12 schemas, 14 recipes, 13 examples, and 279 unique Required cases, but it is not a semantic acceptance validator.
- The task materialization helper compares the locked logical package integrity to raw `.tgz` bytes; that comparison cannot pass for the exact GOWM 0.6.3 source. W01 will retain this discrepancy and implement the upstream-defined logical check plus independent tarball-byte checks.
- GOWM 0.6.3 packages its full base OpenAPI with unresolved relative schema paths and does not export that file through package exports. WSGS will validate bundle schemas/MANIFEST and explicit live routes rather than using blind OpenAPI code generation.
- The Sample World descriptor declares direct operations as `SYNC`; authenticated calls return HTTP `200`. World Query submission returns `202` and completes through polling, but it does not satisfy the distinct direct-operation `202` requirement.
- The original exact-source GOWM 0.6.3 consumer bundle and live gateway produced different semantic hashes. The pinned Sample World operational candidate uses code-point canonical ordering and passes the public three-way lock/handoff/live semantics gate, resolving that drift only for this explicit operational lock.
- The locked `reference.validate@1.0` and `result.validate@1.0` operations expose `CONSISTENT_AT_START`, while prior-grounding revalidation requires `PINNED`; WSGS returns the typed `PINNED_VALIDATION_OPERATION_UNAVAILABLE` gap instead of weakening the policy.
- A separately authorized local test-credential handoff was loaded only in process. Signed availability and trusted execution passed without recording credential values or paths in repository evidence.

## Failed attempts retained

- The unmodified preflight selected the non-executable Microsoft Store `python3` alias. A process-local Git Bash function mapped `python3` to the installed Python 3.9 interpreter; the unmodified script then passed.
- A first sibling worktree was outside the writable task roots, and a nested worktree inherited the same sandbox restriction. The clean worktree was remounted in the task's explicit writable local area without changing the branch or commit.
- Docker Desktop was initially stopped. It was started locally before the isolated PostgreSQL regression gate.

## Actual validation

- Task package: `TASK_PACKAGE_VALID schemas=12 stableRecipes=9 previewRecipes=5 examples=13 acceptance=279`.
- Preflight: `PREFLIGHT_PASS` with WSGS/GOWM/package revisions printed from the supplied lock.
- Fetch reconciliation: WSGS `HEAD == origin/main == 2fdefe3769189fa8e8be4302a9e98ca55cf686d4`; GOWM `HEAD == origin/main == 17dd221330d9af540ec815a39eca96550690299a`.
- Frozen northbound Git tree: `55169cf5157ecb3a9e440d109cebf4ccc82bacbf`.
- Baseline local check without database: 15 test files passed, 1 integration file skipped; 107 tests passed and 9 skipped.
- Baseline with isolated PostgreSQL 17.10: contract freeze, architecture boundary, generated types, strict TypeScript, 16 test files, and all 116 tests passed.
- W01 intake: 25 independent contract/supply-chain checks pass; 62/62 MANIFEST records and 64/64 archive/extracted files verify; three exact-source materializations have identical tarball SHA-256; 7/7 focused positive/negative tests pass.
- Frozen and internal contracts: 25 GOWM checks, 19 northbound schemas, 12 internal schemas, 9 stable recipes, 5 preview recipes, 13 examples, and all generated contract types pass validation.
- Static repository verification: architecture boundaries and strict TypeScript pass; the no-database suite passes 278 tests in 31 files, with 20 database/real-environment tests skipped by design. A later final verification run supersedes these counts where reported in the verification summary.
- Fresh PostgreSQL verification: 20/20 targeted job-store, worker, API, migration-upgrade, and failed-migration rollback tests pass.
- Real semantic model gate: 4/4 strict OpenAI-compatible model cases pass, including prompt-injection handling; every case completed on the first attempt.
- Historical exact-source GOWM gate: 7 checks passed, 2 were blocked, and 0 failed. That run remains negative evidence for the former semantic mismatch and missing direct-operation `202` behavior.
- Sample World public handoff gate: exact 12-file intake, 13 expected cases, 28/28 handoff canaries, public capabilities, and all 122 semantic profiles match the pinned operational lock. Unauthenticated availability and ASYNC direct probes both return HTTP 403 `SCOPE_DENIED`, as required; no authenticated business result is claimed.
- Sample World signed gate: 8 trusted PASS / 2 BLOCKED. Five required operations are AVAILABLE; scoped direct scenarios, World Query `202`/poll, cancellation, and receipt retrieval pass. Direct-operation `202` and `PINNED` validation remain blocked.
- Historical production readiness gate: the API returned HTTP 503 with `SEMANTIC_CATALOG_DRIFT`, proving fail-closed behavior for the old bundled-lock configuration, not readiness of the current Sample World candidate.
- Container verification: the exact Node runtime image builds as non-root UID 10001; Compose configuration validates; a fresh isolated migration service applies and verifies both migrations successfully.

## Remaining work

W02 Gateway Client acceptance now passes fully, including signed availability and transport lifecycle evidence. W13 and W14 remain blocked because direct operations are synchronously HTTP `200` rather than the required `202`, `PINNED` validation is unavailable, and the trusted multi-process production chain, restart matrix, and large-payload object-store path remain incomplete. The candidate must remain Draft and must not emit readiness or stable-candidate completion markers. Draft PR #2 is the publication surface; merge, tag, release, publish, and production deployment remain prohibited.
