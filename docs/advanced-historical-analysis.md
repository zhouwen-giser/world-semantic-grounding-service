# Advanced Historical Analysis Consumption

T5 is a development-only v0.2.3 work item on top of the latest main and v0.2.2 historical consumer. Release manifests and container tags remain 0.2.1. No production qualification, strict replay, current recommendation, route planning, device execution, or full SACS acceptance is claimed.

## Enablement

Both `WSGS_HISTORY_TRACE_ENABLED=YES` and `WSGS_ADVANCED_HISTORY_ENABLED=YES` are required. Advanced history defaults to disabled. The production worker uses exact, locally verified GSAP authorization for three PREVIEW operations; it does not require globally enabling arbitrary PREVIEW capabilities. Existing non-analysis preview behavior remains separately controlled.

Supply `GOWM_SOUTHBOUND_LOCK_FILE` and its exact `GOWM_SOUTHBOUND_LOCK_SHA256` from the actual deployment, with the historical operations and analysis operations registered. The bundled GOWM 0.6.3 lock is not evidence that the deployment contains GSAP. The existing transport token, signed delegation, permissions, data scopes, cancellation and request deadline remain mandatory. Do not commit credentials.

Missing analysis providers are optional for ordinary WSGS readiness. An analysis request still fails closed on unavailable/degraded capabilities, version/hash drift, semantic mismatch, missing permission, or unsupported budget. Corrupt local intake is a configuration error, not a reason to use an unverified provider.

## Questions and DAGs

| Question | Analysis after historical foundation |
| --- | --- |
| 2号车本次任务经过哪些道路？最后确认在哪条道路？是否驶离路网？ | `trajectory.map-match@0.1` |
| 什么时候进入/离开A区？在A区停留多久？什么时候停车？是否经过门岗附近？ | `temporal-spatial.find-events@0.1` |
| 最后一次经过哪个路口？ | `trajectory.map-match@0.1` then `temporal-spatial.find-events@0.1` |
| 通信最好的三个位置？丢包率最低或时延最低的位置？ | `spatiotemporal-metric.rank-locations@0.1` |

Foundation resolution reuses `executeHistoricalTrace`: task discovery/get, execution intervals, historical trajectory. Only one execution is analyzed. LATEST and explicit execution number are supported; ALL is rejected. ACTIVE_PHASES_ONLY goes back through trajectory resolution and never subtracts paused periods locally.

CROSS binds the complete validated T2 result to `/source/mapMatchResult`, not only its ID, hash, or road visits. T3 requests exactly one event type. ENTER/EXIT/DWELL use a uniquely resolved area; PASS_NEAR uses supported target geometry. Geometry comes from `world.get-geometry`, correlated to the trusted reference and validated as EPSG:4326. STOP and CROSS do not query target geometry.

The compiler emits fixed recipes only. Provider input schemas, operation versions, output schemas, semantic profiles, maturity, permission, and snapshot support must match. Execution materializes only those compiler-owned bindings. A compile-only request without resolved historical foundation returns `HISTORICAL_FOUNDATION_REQUIRED` rather than executing hidden reads to manufacture a plan.

## XODR and Collected Data

The XODR-imported road network is consumed through the GSAP map-matching provider behind GOWM Gateway. Configure the provider's graph context upstream; WSGS neither reads the road database nor imports XODR itself. `CURRENT_ACTIVE_TOPOLOGY` is a current network reference model for historical association, not proof of historical physical road conditions.

The seven collected UGV streams remain upstream ingestion responsibilities. WSGS consumes their historical trajectory and scalar measurement projections through the registered operations. It does not connect to MQTT, normalize raw device payloads, access TimescaleDB/PostGIS, or call provider HTTP directly. Provider fixture tests do not establish that a live deployment has ingested all seven streams or has a usable XODR graph.

## Metric Catalog

`config/advanced-history-metric-catalog.json` is schema-validated and canonically hashed. `WSGS_ADVANCED_HISTORY_METRIC_CATALOG_PATH` can select an operator-managed catalog. Every intent records catalog identity/version/hash. Duplicate concepts, conflicting aliases, malformed ranges, and unknown concepts are rejected.

| Concept | observedProperty | Stage | Unit | Default direction |
| --- | --- | --- | --- | --- |
| Communication RSSI | `radio.rssi` | NORMALIZED | dBm | MAXIMIZE |
| Packet loss | `PACKET_LOSS_RATE` | PARSED_NATIVE | percent | MINIMIZE |
| Round-trip latency | `AVERAGE_ROUND_TRIP_TIME` | PARSED_NATIVE | ms | MINIMIZE |

RSSI matches the GSAP fixture contract. Packet-loss and latency fields match the inspected GOWM UGV mapper. A deployment must actually expose the configured scalar series; the catalog does not create measurements. The inspected seven-stream mapper does not define a comparable scalar GNSS-quality or vibration property. Those concepts return `METRIC_CONCEPT_UNSUPPORTED` until an operator supplies an authoritative upstream scalar mapping and validated catalog entry. WSGS does not invent property IDs, fuse units, or compute combined scores.

Multiple series return ambiguity and trusted candidates. A follow-up such as `使用 wifi-rssi` must match exactly one previously returned source/datastream/measurement identity; WSGS then sends EXPLICIT_SERIES constraints and verifies the returned series. It never silently selects the first candidate. A catalog change prevents reusing an old metric interpretation.

## Results and Completeness

Analysis findings use existing `CAPABILITY_RESULT` evidence with real provider schema URI/hash, receipts, evidence IDs, data snapshot, compute snapshot, and upstream status/reason. Only real upstream trajectory/execution references become reference products. Analysis IDs, events, H3 cells, and ranking candidates are not minted as public ReferenceKeys.

Road findings retain off-network, ambiguous segments, upstream gaps, quality breaks, network-data-issue candidates, and association completeness. Off-network is not automatically invalid motion. The last confirmed road is explicitly limited to available evidence; an incomplete suffix cannot establish an absolute final road.

Event findings retain FIRST/LAST `confirmed`, blocking periods, prefix/suffix completeness, and truncation. Unknown intervals are not evidence that no event occurred. Ranking retains `metricTemporalCompletenessKnown=false`, exclusions, alignment/rejection statistics, and series ambiguity. Candidate coordinates come from `representativeVisitedPosition`, never the H3 cell center.

Historical action candidates always carry `currentValidationRequired=true`, `routePlanningRequired=true`, and `executionAuthorized=false`. These are past observed locations, not current recommendations or navigation commands.

## Trusted Follow-ups

Prior advanced evidence is loaded from server-owned persisted result bytes under the same actor/data scope. Result hash, selected product IDs, foundation hash, reference correlation, TTL, finalization and historical scope are checked. Client-provided safe payloads are not trusted. Truncated foundations cannot be reused.

Rank-N can select a retained candidate locally; a missing rank triggers another bounded query. Event LAST is reused only from an untruncated complete event list with a complete suffix and matching event/target. Changing metric can reuse a valid trajectory; changing phase/execution/subject or an expired reference requires historical resolution again. Update checks refresh and compare trajectory version/finalization and analysis inputs/results without a strict-replay claim.

## Budgets

The total request deadline includes foundation, target resolution, compilation and all analysis nodes; it is not restarted per call. Existing bounded Gateway retries and cancellation remain in force. Idempotency incorporates request identity, scope, trajectory/target versions, catalog, plan and node input hashes.

All operations use the contract's `CAMPUS_TASK_DEFAULT` profile. Defaults: 100 events, 100 road visits, 100 segments, Top-K 5 (maximum 50), 100 warnings, 50 series candidates and 262144 safe-payload bytes. Configure the corresponding `WSGS_ADVANCED_HISTORY_*` variables in `.env.example`. Caller result budgets further restrict output. Truncation is explicit and downgrades the result; oversized metadata becomes a compact gap rather than a cropped action coordinate.

## Verification

```bash
npm run advanced-history:contracts
npm run advanced-history:smoke
npm run advanced-history:smoke -- --help
npm run advanced-history:smoke -- --fixture
npm run advanced-history:smoke -- --live
npm run history:smoke -- --help
npm run check
npm run build
npm test
docker compose config --no-interpolate
```

Default/help modes use no network. Fixture mode uses committed outputs captured from the exact GSAP source with a mocked Gateway and needs no Docker. `--live` uses only the existing signed Gateway client; required configuration is listed by `--help`. Missing live configuration reports NOT_RUN, never PASS. Live smoke is not full public API/persistence acceptance.

Contract provenance lives in `contracts/upstream/gowm-analysis-providers-current/source.json`; all original files are byte-pinned and runtime authorization is verified locally. `validation/scripts/intake-analysis-providers.mjs` and `capture-analysis-fixtures.mjs` are explicit developer refresh tools, not runtime dependencies or automatic network calls. Refreshing source requires review and regeneration of pins.

The final work-item evidence is under `reports/wsgs-v0.2.3-advanced-historical-analysis-consumption/`. No merge, tag, release, or deployment is part of this task.
