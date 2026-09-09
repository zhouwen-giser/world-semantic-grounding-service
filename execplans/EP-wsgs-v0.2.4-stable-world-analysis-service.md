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
- W03 COMPLETE: exact 1.2 authorization/request/response validation,
  persisted selection parser, backend payload binding, production result assembly,
  public fingerprint hashing and scripted SQL read/replay isolation implemented.
  Nine Required rows now have audited component/actual HTTP evidence, including
  restored 1.2 metadata, stale generations, cancellation/deadline and exact replay.
  See W03/closure-review.json; real PostgreSQL remains NOT_RUN.
- W04 COMPLETE (Required evidence audit): stored public choice resolver reuses
  prior-grounding identity/scope validation and checks hash/TTL/ownership.
  Production two-round rank/action and three-round series/rank/action now have
  actual HTTP evidence; invalid candidate/hash/expired source rejection included.
  WA-037 through WA-045 are mapped in acceptance-ledger.json, reusing existing
  combined-choice and semantic-change component tests at their proven scope.
- W05 COMPLETE (Required evidence audit): production 1.2 capability document,
  caller-filtered signed discovery and per-operation contract/semantic/freshness
  checks implemented. Exact CROSS/action dependencies and default opt-in covered
  by component tests; signed discovery and provider-failure isolation have actual
  HTTP evidence. WA-046 through WA-054 are mapped in acceptance-ledger.json.
- W06 COMPLETE (controlled local HTTP, not live deployment): real local listener through ProductionGroundingBackend,
  production stage factory, GroundingPipeline, GroundingWorker, public projector,
  AES checkpoint and validated in-memory settlement/GET. Twenty-three HTTP cases cover
  sync/async, default-disabled typed gap, cancellation, queued deadline,
  idempotency/profile isolation, compile-only, legacy 1.0/1.1, signed discovery,
  whole semantic catalog tampering, nonempty history/map matching,
  complete/incomplete CROSS, CROSS source-hash drift, T2 failure isolation,
  post-failure ordinary reference/history queries, T4 Top-K and two/three-round
  stored series/rank/action selections including three negative selection paths.
  Actual selection retries preserve result bytes; changed candidate/metric with
  the same idempotency key returns 409 without new jobs or Gateway calls.
  WA-055 through WA-063 are mapped in acceptance-ledger.json. This closes the
  Required local scope, not optional real-provider or PostgreSQL verification.
- W07 COMPLETE (Required development delivery): permanent public-only consumer
  bundle, isolated process verification, focused separate review pass, all 72
  evidence-backed rows and final report validation PASS. Seven independent
  required commands passed on implementation commit 14dffed. Draft PR #15 is
  OPEN/Draft; #14 remains unmerged. Real services/device qualification remains
  NOT_RUN. Final reports and PR_BODY are in the report root; W07/DELIVERY.md
  provides precise references instead of duplicate final-report files.

## Contract Discipline

Target `sacs-wsgs-grounding/1.2` + `wsgs-world-analysis-findings/1.0`.
Do not change old 1.0/1.1/geospatial artifacts. Freeze first; after freeze any
necessary externally visible change must explicitly withdraw an undistributed
candidate and repeat W01, never silently refresh a released lock.

## Execution Reset: 2026-09-07

The user requested a review of excessive execution time and a revised task.
The previous workflow repeatedly ran full regression for small test additions,
left already-proven boundaries marked open, accumulated overlapping progress
reports and deferred the actual consumer deliverable. Correct the workflow,
not the definition of success: the original 72 Required items remain in scope.

Do not resume the old pattern of one additional scenario followed by a complete
check/test/build/HTTP/report cycle. Current verified source is
ce4d156a41a35c7701eecdf82d2cc1fe73406d24: 954 tests passed, 29 skipped,
23 HTTP cases passed, build passed; W03 has a nine-row closure audit.
Preserve existing failed attempts and logs without generating further duplicate
progress snapshots. No runtime change is pending at this reset.

### Batch A: One Remaining-Requirement Audit

Status: COMPLETE. acceptance-ledger.json records 63 PASS and 9 NOT_RUN;
evidence-index.json records the reused evidence. Remaining rows are WA-064
through WA-072, all W07 delivery requirements. No new runtime gap was identified.

- Consolidate WA-001 through WA-072 into one authoritative ledger using existing
  source and command evidence. Close proven W04-W06 rows promptly.
- For every non-PASS row, record the exact unmet requirement, existing evidence,
  missing proof or defect, and the specific smallest corrective deliverable.
- A proposed new test or refactor must address one such row or an observed bug.
  Vague goals such as broader recovery or more complete compatibility do not
  justify expanding the implementation backlog.
- Do not require HTTP proof for an item whose specified scope is adequately
  proven by component tests. Do not use component evidence where HTTP is required.

### Batch B: Required Gaps and Consumer Delivery

Status: COMPLETE. The permanent 483-file bundle includes six explicit runtime
dependencies; fresh filesystem-restricted Node processes verified 44 complete
examples, two-round linkage and four damaged-bundle rejection cases.

- Implement only the concrete gaps found in Batch A; no new capability families,
  query engines, generic security framework or unrelated refactoring.
- Finish contracts/consumers/sacs-world-analysis-v1 and the independent clean
  consumer verification command using the already frozen public contracts.
- Include complete request/result/job/capabilities/selection/cancel examples,
  explicit dependency closure, hashes and required negative verification cases.
- Use focused tests during edits. Optional live Gateway/PostgreSQL/model/SACS
  verification remains NOT_RUN unless an authorized isolated environment exists;
  do not install or start other projects to turn those optional items into PASS.

### Batch C: Final Verification and Handoff

Status: COMPLETE. W07 final-check/tests/build/contract/fixture/http and
handoff-validation all PASS. Full test commands each record 954 PASS/29 skipped;
HTTP has 23 PASS and fixture has 43 PASS. Final reports qualify only Required
development scope. Draft PR: https://github.com/zhouwen-giser/world-semantic-grounding-service/pull/15.

- Run the required independent commands once against the completed code batch:
  check, test, build, contract verification, fixture smoke, HTTP and handoff.
- On failure, fix the diagnosed issue and rerun the affected checks; obtain a
  coherent final passing evidence set without replaying unchanged work solely
  because a report commit changed HEAD.
- Produce one final ledger/evidence index, FINAL_REPORT.md/json, limitations,
  review and PR_BODY.md. Link existing detailed logs instead of cloning them.
- Commit the deliverable, push the dedicated branch and create the required
  Draft PR when authorized. No merge, tag, release, deployment or device action.
- Finish only when all original Required items are proved. Remote-delivery
  restrictions, if encountered, must be reported separately from local results.

Each batch must reduce the explicit remaining-item list or produce its named
deliverable. Do not begin another open-ended verification round after a batch.
The current user turn is a replanning turn, not authorization to conceal gaps
or to replace the original integration with a smaller fixture-only deliverable.

## Evidence

Use `validation/scripts/run-world-analysis-evidence.mjs` for actual command
stdout/stderr, exit code and source identity. Report all skipped tests and failed
attempts. Final evidence hashes must match actual files; the package report
checker verifies format only and cannot replace code review or test execution.
