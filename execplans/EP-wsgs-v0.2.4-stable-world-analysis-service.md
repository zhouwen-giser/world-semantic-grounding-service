# WSGS v0.2.4 Stable World Analysis Service

## Scope and Authority

Implement the complete task package in `WSGS_v0.2.4_Stable_World_Analysis_Codex_Goal/`.
Only WSGS is writable for this task. No upstream implementation, deployment,
merge, tag, release, device execution or production qualification. v0.2.4 is a
work item; preserve VERSION, package versions and image tags.

Required: WA-001 through WA-072, L0 contracts/unit and L1 actual local HTTP with
explicit controlled dependencies. L2 Gateway/PostgreSQL/model/SACS are separate
optional NOT_RUN scopes; L3 is deferred. Never substitute fixture output for a
high-level production result or claim a narrower test proves a broader boundary.

## Baseline

Remote fetch completed before changes. Main: `565e52705bb7656d4623a04655001325ca61acd0`.
T5: `0db24edf8490766346904c5ab71fd78fbf3afb5d`, PR #14 OPEN/Draft, unmerged.
The working tree was clean. Dedicated branch:
`codex/wsgs-v0.2.4-stable-world-analysis-service`, created from T5 without repeated merges.

## Ordered Gates

- W00 COMPLETE: package integrity, ancestry, actual request/storage/recovery
  path, immutable legacy byte hashes, independent baseline commands and evidence.
- W01 COMPLETE: freeze commit e05e6d4d5ac8de617857edc8e81b935e5efc7daf;
  45 schemas, 15 generated types, 44 full examples and 836 assertions PASS.
  One uncommitted candidate explicitly withdrawn for stale document state;
  original locks retained. Final freeze precedes all new runtime work.
- W02 COMPLETE: validated five-kind projection, provenance closure, explicit
  completeness versus display truncation, 28 fixture tests, 157 related tests,
  nine fixed hash pairs, bounded output and unchanged frozen contract PASS.
- W03 NOT_STARTED: exact negotiation throughout API/backend/worker/store/GET,
  idempotency and recovery; append-only migration only if needed.
- W04 NOT_STARTED: actor/scope/hash/TTL-bound choices, semantic invalidation,
  observed-position action candidates with three requirements and no authority.
- W05 NOT_STARTED: per-capability support/availability with exact dependencies,
  default opt-in, unrelated Grounding/GDPS isolation.
- W06 NOT_STARTED: full regression and production-assembly local HTTP sync,
  async worker/GET, multiround, failure and compatibility evidence.
- W07 NOT_STARTED: isolated consumer handoff, independent final review, all
  72 evidence-backed rows, report verifier and dedicated Draft PR.

## Contract Discipline

Target `sacs-wsgs-grounding/1.2` + `wsgs-world-analysis-findings/1.0`.
Do not change old 1.0/1.1/geospatial artifacts. Freeze first; after freeze any
necessary externally visible change must explicitly withdraw an undistributed
candidate and repeat W01, never silently refresh a released lock.

## Evidence

Use `validation/scripts/run-world-analysis-evidence.mjs` for actual command
stdout/stderr, exit code and source identity. Report all skipped tests and failed
attempts. Final evidence hashes must match actual files; the package report
checker verifies format only and cannot replace code review or test execution.
