# WSGS Historical Trace Consumption Final Report

## Decision

`DEV_READY`

This decision is development-only. It does not qualify a production release, freeze a contract, deploy a runtime, or assert exact-head runtime qualification.

## Actual Source State

- Task package: `WSGS_v0.2.2_Historical_Trace_Consumption_Codex_Goal.zip`
- Task package SHA-256: `315ae84a5c62a383eb9f58db1ad8d2b86cc948869c065f602eeeee1734cd8e87`
- Task package preflight: `TASK_PACKAGE_PREFLIGHT_PASS`, 15 query cases, 89 required acceptance rows
- WSGS base and `origin/main`: `6332546c0f755dbd7f5ba6a138a5825c1619872e`
- GOWM inspected `origin/main`: `385a5756a179cf2a20aa103a24a5a2253cdd1c40`
- GOWM development workspace observed at `a4023f545e7d43beac316abc3ad510f96ccfea61`
- GOWM history contract change observed: v0.7.1 interval query/result and v0.7.1 trajectory result; all four consumed operations are PREVIEW at `1.0`
- Repository release surfaces remain locked at `0.2.1`; v0.2.2 names this work item and branch, not a release or tag

## Implemented

- Deterministic interval, trajectory, completeness, and gap intents with `LATEST`, bounded positive `EXECUTION_NO`, `ALL`, and `ACTIVE_PHASES_ONLY`.
- Explicit/known/prior/unique-active task selection, unique actor inference, and fail-closed Subject-Task association checks.
- Historical requirements and PREVIEW typed query recipes with interval-reference bindings and trajectory preconditions.
- Gateway-only execution of task discovery, task read, interval selection, and trajectory retrieval.
- Normalized interval durations, lifecycle/stability, trajectory completeness, gaps, paused exclusions, inline preview mode, and stable/provisional references.
- Hash-verified multi-turn prior evidence reuse. Completeness and gap projections make zero new GOWM calls; active-only and update follow-ups re-query and compare status, reference versions, finalization, and tracklet inputs.
- Optional historical readiness and capability gaps. Missing history does not fail stable WSGS readiness.
- Feature flags, Compose environment forwarding, source smoke command, and operator documentation.

## Changed Areas

- `packages/historical-trace-consumer`
- `packages/semantic-frame`
- `packages/requirement-planner`
- `packages/query-compiler`
- `services/grounding-worker`
- `.env.example`, `compose.yaml`, `README.md`, and `docs/`
- Deterministic SACS evidence hashes regenerated with existing repository generators; frozen northbound contract bytes remain unchanged

## Historical Questions Supported

- Task start/end, duration, open execution state, pause count, actual execution periods, and all bounded execution records.
- One vehicle's trajectory in an explicit task or its unique active task.
- A positive numbered execution and the latest/current execution.
- Active-phase-only trajectory excluding paused periods.
- Follow-up completeness and gap inspection from retained prior evidence.

## Task/Subject Context Rules

Selection order is explicit task, unique known task, explicitly selected prior task, then unique active task by vehicle. Zero candidates returns `TASK_CONTEXT_REQUIRED`; multiple candidates return `TASK_CONTEXT_AMBIGUOUS`. A task-only trajectory requires exactly one actor. A vehicle-task mismatch returns `SUBJECT_TASK_MISMATCH` before any trajectory call. Candidate arrays are never reduced by first-item guessing.

## Query Plans

- Interval: resolve/bind task, then `operational-task.get-execution-intervals`.
- Trajectory: resolve/discover task, `operational-task.get`, interval selection, then `history.get-trajectory`.
- Trajectory executes only when the interval node is completed/partial and yields an execution-interval reference.
- `ALL` compiles only for an interval list; an all-executions trajectory returns `MULTI_EXECUTION_TRAJECTORY_NOT_SUPPORTED`.
- Default source selection is `ONLY_CANDIDATE`; configured source profile, inline-point bound, and optional analysis space are forwarded.

## Result Normalization

- Durations use only GOWM-returned periods and never wall-clock extrapolation.
- Gap, pause, and stop semantics remain distinct.
- Inline points are `FULL` only when all completeness evidence agrees; otherwise they are `BOUNDED_PREVIEW` and no full geometry is synthesized.
- Pending maps to `HISTORICAL_PROJECTION_PENDING`; conflicted results are indeterminate and do not publish a trajectory reference.
- Open/provisional references use a short revalidation TTL; sealed references are stable.
- Existing `WORLD_EVIDENCE` and `DERIVED_REFERENCES` result surfaces are used without changing the requested-product enum.

## Tests Actually Run

- Task package preflight: PASS.
- Focused historical/compiler/planner/semantic/worker suite: 5 files, 117 tests passed.
- Full `npm run check`: PASS.
- Full default Vitest suite within the check: 55 files passed, 4 skipped; 642 tests passed, 25 skipped; 0 failed.
- Architecture boundary: PASS, including Gateway-only and no direct GDPS access.
- Development acceptance closure: 63/63 PASS, production qualified remains false.

## Optional Smoke Result

`npm run history:smoke -- --help` passed and proves that the source-only command loads without Docker. A live smoke was not run because no concrete task/vehicle reference pair was supplied. The command requires the current GOWM lock and signing configuration, performs one interval query and one trajectory query, and verifies output schema hashes.

## Upstream Changes

- GOWM+: NONE. Its worktree was clean when rechecked.
- GDPS: NONE by this task. Its pre-existing dirty worktree was left untouched.

## Explicit Deferrals

- XODR map matching and passed-road/intersection derivation
- Temporal-spatial events and stop inference
- Historical metric ranking
- Complete trajectory artifact retrieval beyond bounded inline preview
- Strict pinned replay
- Productization, production security qualification, deployment, tag, and release

## Git Delivery

- Branch: `codex/wsgs-v0.2.2-historical-trace-consumption`
- Draft PR: pending final commit and push

## Final Marker

`WSGS_HISTORICAL_TRACE_CONSUMPTION_DEV_READY`
