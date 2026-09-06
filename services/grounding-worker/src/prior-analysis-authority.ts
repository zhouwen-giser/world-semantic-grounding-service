import type { Pool } from "pg";
import type { GroundingRequest12 } from "@wsgs/contracts";
import { isWorldAnalysisContract, parseGroundingContractSelection, type PipelineJournal } from "@wsgs/grounding-pipeline";
import { PriorGroundingError, resolveStoredAnalysisSelection, type PriorGroundingIdentity, type PriorGroundingPointer, type ResolvedPriorAnalysisSelection } from "@wsgs/prior-grounding";
import type { AdvancedHistoricalExecutionResult } from "@wsgs/historical-trace-consumer";

export interface PriorAnalysisAuthority extends ResolvedPriorAnalysisSelection {
  advanced: AdvancedHistoricalExecutionResult;
}
interface PriorRow {
  grounding_id: string;
  job_id: string;
  principal_id: string;
  actor_id: string;
  data_scope: string;
  dataset_scopes: string[];
  authorization_context_hash: string;
  result_hash: string;
  result_bytes: Buffer;
  source_expires_at: Date;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** The joined result row authorizes lookup of its private encrypted checkpoint. */
export async function loadPriorAnalysisAuthority(input: {
  pool: Pick<Pool, "query">;
  journal: Pick<PipelineJournal, "loadLatestCheckpoint">;
  identity: PriorGroundingIdentity;
  dataScope: string;
  pointer: PriorGroundingPointer;
  selection?: NonNullable<GroundingRequest12["analysisSelections"]>[number];
  ordinal?: number;
  now?: Date;
}): Promise<PriorAnalysisAuthority> {
  const found = await input.pool.query<PriorRow>(
    `SELECT result.grounding_id, result.result_hash, result.result_bytes,
            request.principal_id, request.actor_id, request.data_scope, request.dataset_scopes,
            request.authorization_context_hash, request.source_expires_at, job.job_id
       FROM wsgs.grounding_result AS result
       JOIN wsgs.grounding_request AS request ON request.grounding_id = result.grounding_id
       JOIN wsgs.grounding_job AS job ON job.grounding_id = result.grounding_id
      WHERE result.grounding_id = $1 AND request.data_scope = $2 AND request.actor_id = $3
        AND request.principal_id = $4 AND request.authorization_context_hash = $5`,
    [input.pointer.groundingId, input.dataScope, input.identity.actorId, input.identity.servicePrincipalId, input.identity.authorizationContextHash]
  );
  const row = found.rows[0];
  const resolved = resolveStoredAnalysisSelection({ ...input, stored: row ? {
    groundingId: row.grounding_id, servicePrincipalId: row.principal_id, actorId: row.actor_id,
    dataScope: row.data_scope, datasetScopes: row.dataset_scopes, authorizationContextHash: row.authorization_context_hash,
    resultHash: row.result_hash, resultBytes: row.result_bytes, expiresAt: row.source_expires_at.toISOString()
  } : null });
  const fingerprint = resolved.result.execution.runFingerprint;
  const checkpoint = await input.journal.loadLatestCheckpoint(row!.job_id, fingerprint);
  if (!checkpoint || checkpoint.jobId !== row!.job_id || checkpoint.runFingerprint !== fingerprint ||
    !isWorldAnalysisContract(parseGroundingContractSelection(checkpoint.state["contractSelection"]))) throw new PriorGroundingError("SELECTION_INVALID");
  const assembled = record(checkpoint.state["PRODUCT_ASSEMBLE"]);
  if (!assembled || assembled["groundingId"] !== row!.grounding_id || assembled["resultHash"] !== row!.result_hash) throw new PriorGroundingError("SELECTION_INVALID");
  const execution = record(checkpoint.state["GOWM_EXECUTE"]);
  const advanced = record(execution?.["advancedExecution"]);
  if (!advanced || !record(advanced["intent"]) || !record(advanced["foundation"]) || !Array.isArray(advanced["analysisEvidence"])) throw new PriorGroundingError("SELECTION_INVALID");
  return { ...resolved, advanced: advanced as unknown as AdvancedHistoricalExecutionResult };
}
