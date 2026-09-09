import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createGroundingIdentity } from "@wsgs/delegated-identity";
import { Aes256GcmPayloadCodec, WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION, LEGACY_GROUNDING_CONTRACT_SELECTION } from "@wsgs/grounding-pipeline";
import { PostgresGroundingWorkerStore } from "./postgres-store.js";

const identity = createGroundingIdentity({ servicePrincipalId: "service-a", actorId: "actor-a", dataScopes: ["scope-a"], datasetScopes: [], permissions: ["grounding.read"] });
const codec = new Aes256GcmPayloadCodec(Buffer.alloc(32, 7));
const result = JSON.parse(readFileSync(new URL("../../../contracts/wsgs-v0.2.4-world-analysis/examples/empty.json", import.meta.url), "utf8"));
const settlement = { kind: "RESULT" as const, status: result.status, resultHash: result.resultHash, resultBytes: Buffer.from(JSON.stringify(result)) };

async function fixture(metadata: Record<string, unknown> = { contractSelection: WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION }) {
  const request = { schemaVersion: "1.0", requestId: "request-1", analysisSelections: [{ candidateId: "candidate-1" }] };
  const sealed = await codec.seal(Buffer.from(JSON.stringify(request)), { groundingId: "grounding-1", requestId: "request-1" });
  const row = { job_id: "job-1", grounding_id: "grounding-1", request_id: "request-1", operation: "EXECUTE_WORLD_QUERY", attempts: 1,
    stage_generation: 4, deadline_at: new Date(Date.now() + 60_000), max_result_bytes: 1048576, immutable_locks: { source: "test" },
    source_text_ciphertext: Buffer.from(sealed), data_scope: "scope-a", actor_id: identity.actorId, principal_id: identity.servicePrincipalId,
    dataset_scopes: [], authorization_context_hash: identity.authorizationContextHash, idempotency_key: "key-1",
    request_metadata: { permissions: identity.permissions, dataScopes: identity.dataScopes, ...metadata },
    lease_token: "", status: "RUNNING", cancel_requested_at: null as Date | null, deadline_expired: false };
  const writes: string[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("request.request_metadata->>'operation'")) return { rows: [row] };
    if (sql.includes("RETURNING attempts, stage_generation")) {
      row.lease_token = String(values[1]);
      row.stage_generation += 1;
      return { rows: [{ attempts: ++row.attempts, stage_generation: row.stage_generation }] };
    }
    if (sql.includes("WHERE job.job_id = $1 FOR UPDATE OF job")) {
      expect(sql).toContain("job.deadline_at <= clock_timestamp() AS deadline_expired");
      return { rows: [row] };
    }
    if (sql.includes("INSERT INTO") || sql.includes("UPDATE wsgs.idempotency")) writes.push(sql);
    return { rows: [] };
  };
  const pool = { connect: async () => ({ query, release() {} }) } as unknown as Pool;
  return { row, request, writes, store: new PostgresGroundingWorkerStore(pool, codec) };
}

describe("production worker recovery policy with scripted SQL and real encrypted requests", () => {
  it("restores 1.2 metadata and selections across reclaims and rejects the stale generation", async () => {
    const f = await fixture();
    const first = (await f.store.claimNext("worker-a", 1000))!;
    const recovered = (await f.store.claimNext("worker-b", 1000))!;
    expect(recovered.initialState["contractSelection"]).toEqual(WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION);
    expect(recovered.initialState["request"]).toEqual(f.request);
    expect(recovered.generation).toBe(first.generation + 1);
    expect(await f.store.settle(first, settlement)).toBe("FENCE_REJECTED");
    expect(f.writes).toEqual([]);
    expect(await f.store.settle(recovered, settlement)).toBe("APPLIED");
    expect(f.writes.some(sql => sql.includes("INSERT INTO wsgs.grounding_result"))).toBe(true);
  });

  it.each(["cancel", "deadline", "terminal"])("rejects late 1.2 completion after %s", async cause => {
    const f = await fixture();
    const claim = (await f.store.claimNext("worker-a", 1000))!;
    if (cause === "cancel") f.row.cancel_requested_at = new Date();
    if (cause === "deadline") f.row.deadline_expired = true;
    if (cause === "terminal") f.row.status = "FAILED";
    expect(await f.store.settle(claim, settlement)).toBe("FENCE_REJECTED");
    expect(f.writes).toEqual([]);
  });

  it("preserves legacy metadata-free recovery and refuses malformed 1.2 authority", async () => {
    const legacy = await fixture({});
    expect((await legacy.store.claimNext("worker-a", 1000))?.initialState["contractSelection"]).toEqual(LEGACY_GROUNDING_CONTRACT_SELECTION);
    const invalid = await fixture({ contractSelection: { ...WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION, resultProfile: "unknown" } });
    const settle = vi.spyOn(invalid.store, "settle");
    await expect(invalid.store.claimNext("worker-a", 1000)).resolves.toBeNull();
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", generation: 5 }), {
      kind: "FAILED", errorCode: "WORKER_CLAIM_INVALID", pipelineStage: "LOAD_CONTEXT", retryable: false
    });
  });
});
