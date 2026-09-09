import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresProductionGroundingStore, PostgresGroundingContractMismatchError, PostgresIdempotencyConflictError } from "./postgres-backend-store.js";
import { LEGACY_GROUNDING_CONTRACT_SELECTION, SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION, WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION } from "./contract-selection.js";

const identity = { servicePrincipalId: "service-a", actorId: "actor-a", dataScope: "scope-a", dataScopes: ["scope-a"], datasetScopes: [], permissions: [], authorizationContextHash: `sha256:${"a".repeat(64)}` };
const result = JSON.parse(readFileSync(new URL("../../../contracts/wsgs-v0.2.4-world-analysis/examples/empty.json", import.meta.url), "utf8"));

// A scripted SQL boundary exercises production read/replay policy, not PostgreSQL semantics.
function fixture(metadata: unknown = { contractSelection: WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION }, terminal = true) {
  const queries: string[] = [];
  const row = { job_id: "job-1", grounding_id: "grounding-1", request_id: "request-1", status: terminal ? "COMPLETED" : "RUNNING",
    created_at: new Date("2026-09-06T00:00:00Z"), updated_at: new Date("2026-09-06T00:00:01Z"), started_at: null, finished_at: null,
    error: null, result_bytes: terminal ? Buffer.from(JSON.stringify(result)) : null, request_metadata: metadata };
  const query = async (sql: string, values?: unknown[]) => {
    queries.push(sql);
    if (sql.includes("FROM wsgs.idempotency")) return { rows: [{ payload_hash: "payload-a", grounding_id: "grounding-1", result_bytes: row.result_bytes }] };
    if (sql.includes("FROM wsgs.grounding_job AS job")) {
      expect(values).toEqual([identity.dataScope, identity.actorId, "grounding-1", identity.servicePrincipalId, identity.authorizationContextHash]);
      return { rows: [row] };
    }
    if (sql.includes("UPDATE wsgs.grounding_job")) row.status = "CANCELLED";
    return { rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  return { store: new PostgresProductionGroundingStore(pool), queries };
}

describe("production PostgreSQL adapter contract policy with scripted SQL", () => {
  it.each([true, false])("replays the exact stored resource, terminal=%s", async terminal => {
    const { store } = fixture(undefined, terminal);
    const lookup = { identity, idempotencyKey: "key-a", payloadHash: "payload-a", contractSelection: WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION };
    const first = await store.replay(lookup);
    expect(await store.replay(lookup)).toEqual(first);
    expect(first?.kind).toBe(terminal ? "REPLAY_RESULT" : "REPLAY_JOB");
    if (terminal) expect(first).toMatchObject({ result });
    await expect(store.replay({ ...lookup, payloadHash: "changed" })).rejects.toBeInstanceOf(PostgresIdempotencyConflictError);
  });

  it.each([LEGACY_GROUNDING_CONTRACT_SELECTION, SACS_GEOSPATIAL_GROUNDING_CONTRACT_SELECTION])("rejects cross-profile reads and cancellation for $contractVersion", async selection => {
    const { store, queries } = fixture();
    await expect(store.get(identity, "grounding-1", selection)).rejects.toBeInstanceOf(PostgresGroundingContractMismatchError);
    await expect(store.cancel(identity, "grounding-1", selection)).rejects.toBeInstanceOf(PostgresGroundingContractMismatchError);
    expect(queries.some(query => query.includes("UPDATE wsgs.grounding_job"))).toBe(false);
  });

  it("keeps metadata-free historical rows legacy and rejects malformed stored selections", async () => {
    await expect(fixture({}).store.get(identity, "grounding-1", LEGACY_GROUNDING_CONTRACT_SELECTION)).resolves.toMatchObject({ jobId: "job-1" });
    await expect(fixture({}).store.get(identity, "grounding-1", WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION)).rejects.toBeInstanceOf(PostgresGroundingContractMismatchError);
    await expect(fixture({ contractSelection: { ...WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION, injected: true } }).store.get(identity, "grounding-1", WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION)).rejects.toBeInstanceOf(PostgresGroundingContractMismatchError);
  });

  it("returns the stored terminal result without cancelling or projecting it", async () => {
    const { store, queries } = fixture();
    expect(await store.get(identity, "grounding-1", WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION)).toMatchObject({ result });
    expect(await store.cancel(identity, "grounding-1", WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION)).toMatchObject({ value: { status: "COMPLETED", result } });
    expect(queries.some(query => query.includes("UPDATE wsgs.grounding_job"))).toBe(false);
  });
});
