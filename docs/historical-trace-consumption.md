# Historical Trace Consumption

The WSGS v0.2.2 historical-trace work item adds development-only consumption of task execution intervals and historical trajectories from the latest GOWM Gateway. The repository's locked 0.2.1 release surfaces remain unchanged. The implementation is optional and does not change the `sacs-wsgs-grounding/1.0` requested-product enum or create a second API, worker, queue, or database schema.

## Upstream boundary

The implementation was developed against WSGS `6332546c0f755dbd7f5ba6a138a5825c1619872e` and GOWM main `385a5756a179cf2a20aa103a24a5a2253cdd1c40`. It consumes only these PREVIEW operations at version `1.0`:

| Operation | Purpose |
| --- | --- |
| `operational-task.find` | Find a unique active task for an explicitly grounded vehicle |
| `operational-task.get` | Read the task and validate its actor association |
| `operational-task.get-execution-intervals` | Select `LATEST`, a positive `EXECUTION_NO`, or a bounded `ALL` interval list |
| `history.get-trajectory` | Read the trajectory for one selected execution interval |

There is no compatibility adapter for older GOWM history contracts and no WSGS-owned consumer lock. Deployments must supply the hash-locked operation lock exported by the same current GOWM deployment through `GOWM_SOUTHBOUND_LOCK_FILE` and `GOWM_SOUTHBOUND_LOCK_SHA256`.

The upstream deployment imports the XODR/OpenDRIVE road network and materializes operational state from the seven real-time streams. WSGS does not read MQTT or XODR directly. It consumes the task and trajectory projections produced from those inputs. Road matching, passed-road/intersection derivation, stop inference, event timelines, and route ranking remain deferred; an inline trajectory preview is never presented as a road-matched route.

## Enablement

Both PREVIEW gates must be enabled:

```dotenv
WSGS_ALLOW_PREVIEW_CAPABILITIES=YES
WSGS_HISTORY_TRACE_ENABLED=YES
WSGS_HISTORY_SOURCE_SELECTION_PROFILE_REFERENCE={"namespace":"gowm.history","kind":"HISTORY_METHOD_PROFILE","id":"trajectory-single-authoritative-v1","version":"1.0"}
WSGS_HISTORY_MAX_INLINE_POINTS=256
WSGS_HISTORY_DEFAULT_ANALYSIS_SPACE_REFERENCE=
WSGS_HISTORY_PROVISIONAL_REFERENCE_TTL_MS=60000
WSGS_HISTORY_ALL_INTERVALS_LIMIT=100
WSGS_HISTORY_PENDING_RETRY_MS=0
```

Startup treats history operations as optional. Missing, disabled, or unavailable history operations produce a blocking capability gap only for a historical request; existing stable WSGS flows remain available. Source selection defaults to `ONLY_CANDIDATE`. Multiple sources return `TRAJECTORY_SOURCE_AMBIGUOUS`; WSGS never merges them automatically.

## Query behavior

Supported intent families are execution interval, historical trajectory, trajectory completeness, and trajectory gaps. Deterministic Chinese phrases cover latest/current execution, a bounded positive execution number, all execution records, and active-phase-only trajectories.

Task context is selected in this order: explicit grounded task, unique known task, explicitly selected prior task, then a unique active task found for the grounded vehicle. Multiple candidates are never reduced to the first item. Before requesting a trajectory, WSGS reads the task and requires the requested vehicle to be one of its actors. A mismatch returns `SUBJECT_TASK_MISMATCH` and stops before `history.get-trajectory`.

`ALL` is supported only for interval lists. An all-executions trajectory request returns `MULTI_EXECUTION_TRAJECTORY_NOT_SUPPORTED`. A pending or conflicted interval also stops before trajectory execution. Pending is reported as `HISTORICAL_PROJECTION_PENDING`; it is not treated as a worker failure and no polling state machine is created. `WSGS_HISTORY_PENDING_RETRY_MS` defaults to `0`; a positive value enables exactly one bounded retry.

## Result semantics

Execution envelope, active, and paused durations are derived exclusively from the periods returned by GOWM. Open intervals retain their open/provisional state and use the returned period endpoint as `durationAsOf`; wall-clock time is not invented.

Trajectory completeness, defined periods, excluded paused periods, and gaps are preserved separately. A gap does not imply that a vehicle stopped, and a paused interval does not imply missing telemetry. Inline points are marked `FULL` only when temporal coverage, prefix/suffix completeness, and point count all prove completeness. Otherwise they are `BOUNDED_PREVIEW`; WSGS does not construct a full `LineString` from a preview.

Sealed references are stable. Open/provisional references require revalidation and receive the configured short TTL. Pending or conflicted results do not publish a trajectory reference. Results use existing `WORLD_EVIDENCE` and `DERIVED_REFERENCES` surfaces.

Completeness and gap follow-ups reuse a prior trajectory finding without another GOWM call. Active-phase-only, update, and expired-provisional follow-ups take the normal re-query path.

## Source smoke

The optional smoke test runs directly from source and does not require Docker. It needs the current GOWM operation lock, signing identity, one task reference, and an associated vehicle reference:

```bash
npm run history:smoke -- --help

WSGS_HISTORY_SMOKE_TASK_REFERENCE_JSON='{"namespace":"gowm","kind":"OPERATIONAL_TASK","id":"wrf_...","version":"..."}' \
WSGS_HISTORY_SMOKE_SUBJECT_REFERENCE_JSON='{"namespace":"gowm","kind":"WORLD_OBJECT","id":"wrf_...","version":"..."}' \
npm run history:smoke
```

The smoke performs one latest interval query and one trajectory query, checks the exact output schema hashes from the supplied lock, and prints `WSGS_HISTORY_SMOKE_PASS`. It is deliberately excluded from the default test command.

Completion status for this feature is `WSGS_HISTORICAL_TRACE_CONSUMPTION_DEV_READY`. It is not a production-readiness, frozen-contract, deployment, or exact-head qualification claim.
