import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { Aes256GcmPayloadCodec, PostgresPipelineJournal, WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION, canonicalSha256, type PipelineCheckpoint } from "@wsgs/grounding-pipeline";
import { loadPriorAnalysisAuthority } from "./prior-analysis-authority.js";

const example = (name: string) => JSON.parse(readFileSync(new URL(`../../../contracts/wsgs-v0.2.4-world-analysis/examples/${name}.json`, import.meta.url), "utf8"));
async function fixture(change: "none" | "scope" | "hash" | "cipher" | "result" | "missing" | "reference" = "none") {
  const result = example(change === "reference" ? "all-choices" : "ranking"); const request = example("request-selection");
  if (change === "reference") {
    const choice = result.worldAnalysisFindings.choices.find((value: { choiceKind: string }) => value.choiceKind === "REFERENCE_SELECTION");
    request.contextCapsule.priorGroundings[0].resultHash = result.resultHash;
    request.analysisSelections[0] = { priorGroundingId: result.groundingId, priorResultHash: result.resultHash,
      findingSetHash: result.worldAnalysisFindings.findingSetHash, choiceId: choice.choiceId, candidateId: choice.candidates[0].candidateId };
  }
  const identity = { servicePrincipalId: "service", actorId: "actor", dataScopes: ["scope"], datasetScopes: [], permissions: ["grounding.read"], authorizationContextHash: `sha256:${"a".repeat(64)}` as const };
  const advanced = { intent: { test: "server-owned" }, foundation: { test: "server-owned" }, analysisEvidence: [] };
  const state = { contractSelection: WORLD_ANALYSIS_GROUNDING_CONTRACT_SELECTION,
    PRODUCT_ASSEMBLE: { ...result, ...(change === "result" ? { resultHash: `sha256:${"f".repeat(64)}` } : {}) }, GOWM_EXECUTE: change === "reference" ? {} : { advancedExecution: advanced } };
  const checkpoint: PipelineCheckpoint = { schemaVersion: "1.0", jobId: "job-1", operation: "EXECUTE_WORLD_QUERY", runFingerprint: result.execution.runFingerprint,
    nextStageIndex: 14, nextEventSequence: 28, state, previousRecordHash: `sha256:${"c".repeat(64)}`, lastCompletedStage: "RESULT_PERSIST" };
  const codec = new Aes256GcmPayloadCodec(Buffer.alloc(32, 8));
  const cipher = Buffer.from(await codec.sealCheckpoint(checkpoint));
  if (change === "cipher") cipher[cipher.length - 1] = cipher[cipher.length - 1]! ^ 1;
  let checkpointReads = 0;
  const pool = { query: async (sql: string, values: unknown[]) => {
    if (sql.includes("FROM wsgs.grounding_result AS result")) {
      expect(values).toEqual([result.groundingId, "scope", identity.actorId, identity.servicePrincipalId, identity.authorizationContextHash]);
      return { rows: change === "scope" ? [] : [{ grounding_id: result.groundingId, job_id: "job-1", principal_id: identity.servicePrincipalId,
        actor_id: identity.actorId, data_scope: "scope", dataset_scopes: [], authorization_context_hash: identity.authorizationContextHash,
        result_hash: result.resultHash, result_bytes: Buffer.from(JSON.stringify(result)), source_expires_at: new Date("2026-09-06T02:01:00Z") }] };
    }
    checkpointReads++;
    expect(values).toEqual(["job-1", result.execution.runFingerprint]);
    return { rows: change === "missing" ? [] : [{ job_id: "job-1", operation: checkpoint.operation, run_fingerprint: checkpoint.runFingerprint,
      next_stage_index: 14, next_event_sequence: 28, state_ciphertext: cipher, state_hash: change === "hash" ? "bad" : canonicalSha256(state),
      previous_record_hash: checkpoint.previousRecordHash, last_completed_stage: "RESULT_PERSIST" }] };
  } } as unknown as Pool;
  return { advanced, reads: () => checkpointReads, input: { pool, journal: new PostgresPipelineJournal(pool, codec), identity, dataScope: "scope",
    pointer: request.contextCapsule.priorGroundings[0], selection: request.analysisSelections[0], now: new Date("2026-09-06T02:00:01Z") } };
}
describe("private analysis authority restoration", () => {
  it("restores an ordinary reference Choice without fabricating historical analysis", async () => {
    const f = await fixture("reference");
    const restored = await loadPriorAnalysisAuthority(f.input);
    expect(restored.candidate).toHaveProperty("referenceProductId");
    expect(restored.advanced).toBeUndefined();
  });
  it("binds a scope-authorized stored Choice to its real decrypted checkpoint", async () => {
    const f = await fixture();
    expect((await loadPriorAnalysisAuthority(f.input)).advanced).toEqual(f.advanced);
    expect(f.reads()).toBe(1);
  });
  it("never reads a checkpoint when the result is outside scope", async () => {
    const f = await fixture("scope");
    await expect(loadPriorAnalysisAuthority(f.input)).rejects.toThrow("PRIOR_RESULT_NOT_FOUND_IN_SCOPE");
    expect(f.reads()).toBe(0);
  });
  it.each(["hash", "cipher", "result", "missing"] as const)("refuses %s checkpoint corruption or loss", async change => {
    const f = await fixture(change);
    await expect(loadPriorAnalysisAuthority(f.input)).rejects.toThrow();
  });
});
