// Optional fixture refresh only. Default tests consume committed envelopes and
// never import or contact a Provider implementation.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv[2];
if (!root) throw new Error("Usage: tsx validation/scripts/capture-analysis-fixtures.mjs <read-only upstream>");
const directory = resolve("validation/fixtures/advanced-history");
process.chdir(root);
const load = path => import(pathToFileURL(resolve(root, path)).href);
const adapters = await load("packages/gowm-read-adapter/src/index.ts");
const { MapMatchingProvider } = await load("services/map-matching-provider/src/provider.ts");
const { loadConfig } = await load("services/map-matching-provider/src/config.ts");
const { fixtureExecutionRequest } = await load("scripts/request-fixture.ts");
const { TemporalEventsProvider } = await load("services/temporal-events-provider/src/provider.ts");
const { loadTemporalEventsConfig } = await load("services/temporal-events-provider/src/config.ts");
const { temporalEventsFixtureExecutionRequest } = await load("scripts/request-temporal-events-fixture.ts");
const { MetricRankingProvider } = await load("services/metric-ranking-provider/src/provider.ts");
const { loadMetricRankingConfig } = await load("services/metric-ranking-provider/src/config.ts");
const { metricRankingFixtureExecutionRequest } = await load("scripts/request-metric-ranking-fixture.ts");
mkdirSync(directory, { recursive: true });
const save = (name, value) => writeFileSync(resolve(directory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
const map = new MapMatchingProvider(new adapters.FixtureMapMatchingDataSource(resolve(root, "fixtures/map-matching/shared-campus.json")), loadConfig({ MAP_MATCH_DATA_SOURCE: "fixture" }));
const matched = await map.execute(fixtureExecutionRequest());
save("map-match", matched);
save("map-no-data", await map.execute(fixtureExecutionRequest("missing-trajectory", "1")));
const temporal = new TemporalEventsProvider(new adapters.FixtureHistoricalTrajectoryDataSource(resolve(root, "fixtures/temporal-events/area-events.json")), loadTemporalEventsConfig({ TEMPORAL_EVENTS_DATA_SOURCE: "fixture" }));
save("cross-last", await temporal.execute(temporalEventsFixtureExecutionRequest({ schemaVersion: "0.1", source: { kind: "MAP_MATCH_RESULT", mapMatchResult: matched.output.value }, eventTypes: ["CROSS"], selection: { kind: "LAST" } })));
const areaFixture = JSON.parse(readFileSync(resolve(root, "fixtures/temporal-events/area-events.json"), "utf8"));
for (const eventType of ["ENTER", "EXIT", "DWELL", "STOP", "PASS_NEAR"]) {
  const target = { targetId: "yard", displayName: "A区", targetType: "AREA", crs: "EPSG:4326",
    geometry: { type: "Polygon", coordinates: [[[121.00005, 30.99995], [121.00015, 30.99995], [121.00015, 31.00005], [121.00005, 31.00005], [121.00005, 30.99995]]] },
    referenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: "wrf_fixture_area", version: "1" } };
  const input = { schemaVersion: "0.1", source: { kind: "HISTORICAL_TRAJECTORY", trajectoryReferenceKey: areaFixture.trajectory.trajectoryReferenceKey }, eventTypes: [eventType], ...(eventType === "STOP" ? {} : { targets: [target] }), selection: { kind: "ALL", limit: 100 } };
  save(eventType.toLowerCase(), await temporal.execute(temporalEventsFixtureExecutionRequest(input)));
  if (eventType === "ENTER") save("target", target);
}
for (const name of ["shared-campus", "ambiguous-series", "minimize-metric"]) {
  const fixture = resolve(root, `fixtures/metric-ranking/${name}.json`);
  const data = JSON.parse(readFileSync(fixture, "utf8"));
  const provider = new MetricRankingProvider(new adapters.FixtureHistoricalTrajectoryDataSource(fixture), new adapters.FixtureHistoricalMetricDataSource(fixture), loadMetricRankingConfig({ METRIC_RANKING_DATA_SOURCE: "fixture" }));
  const metricSelector = name === "minimize-metric" ? { observedProperty: "network.latency", valueUnit: "ms", optimizationDirection: "MINIMIZE" } : { observedProperty: "radio.rssi", valueUnit: "dBm", optimizationDirection: "MAXIMIZE" };
  save(`metric-${name}`, await provider.execute(metricRankingFixtureExecutionRequest({ schemaVersion: "0.1", trajectoryReferenceKey: data.trajectory.trajectoryReferenceKey, metricSelector, ranking: { topK: 3 } })));
}
process.stdout.write("Analysis fixture envelopes captured. No live Gateway claim.\n");
