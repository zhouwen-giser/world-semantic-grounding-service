import { createHash } from "node:crypto";

import { canonicalSha256, type ScopedGroundingIdentity } from "@wsgs/grounding-pipeline";
import {
  StructuredSelectionError,
  StructuredWorldSelectionResolver,
  type PriorGroundingResult,
  type ResolveWorldSelectionRequest,
  type ResolveWorldSelectionResult
} from "@wsgs/structured-world-selection";
import type { Pool, PoolClient } from "pg";

export interface StructuredSelectionTokenMetadata {
  keyId: string;
  tokenHash: `sha256:${string}`;
}

export function structuredSelectionTokenMetadata(token: string): StructuredSelectionTokenMetadata {
  const parts = token.split(".");
  const keyId = parts[3];
  if (parts.length !== 7 || parts[0] !== "wsgs" || parts[1] !== "sel" || parts[2] !== "v1" ||
      typeof keyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyId)) {
    throw new StructuredSelectionError("SELECTION_TOKEN_INVALID");
  }
  return Object.freeze({
    keyId,
    tokenHash: `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`
  });
}

async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function advisoryLockKey(identity: ScopedGroundingIdentity, request: ResolveWorldSelectionRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      servicePrincipalId: identity.servicePrincipalId,
      actorId: identity.actorId,
      dataScope: identity.dataScope,
      authorizationContextHash: identity.authorizationContextHash,
      priorGroundingId: request.priorGroundingId,
      findingId: request.findingId,
      featureId: request.featureId
    }))
    .digest()
    .readBigInt64BE(0)
    .toString();
}

/**
 * PostgreSQL owns selection revision allocation and durable bindings. Raw
 * upstream tokens are returned to the authorized caller but never persisted;
 * only their key id, expiry, and SHA-256 digest are stored.
 */
export class PostgresStructuredSelectionStore {
  constructor(
    private readonly pool: Pool,
    private readonly resolver: StructuredWorldSelectionResolver
  ) {}

  async resolve(input: {
    identity: ScopedGroundingIdentity;
    request: ResolveWorldSelectionRequest;
    priorResult: PriorGroundingResult | null;
  }): Promise<ResolveWorldSelectionResult> {
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
        advisoryLockKey(input.identity, input.request)
      ]);
      const authorizedPrior = await client.query<{ present: number }>(
        `SELECT 1 AS present
           FROM wsgs.grounding_result AS result
           JOIN wsgs.grounding_request AS request
             ON request.grounding_id = result.grounding_id
          WHERE result.grounding_id = $1 AND result.result_hash = $2
            AND result.data_scope = $3 AND result.actor_id = $4
            AND request.principal_id = $5 AND request.authorization_context_hash = $6
            AND result.contract_version = 'sacs-wsgs-grounding/1.1'
            AND result.result_profile = 'sacs-wsgs-geospatial-findings/1.0'`,
        [
          input.request.priorGroundingId,
          input.request.priorResultHash,
          input.identity.dataScope,
          input.identity.actorId,
          input.identity.servicePrincipalId,
          input.identity.authorizationContextHash
        ]
      );
      if (!authorizedPrior.rows[0]) throw new StructuredSelectionError("SELECTION_NOT_FOUND");
      const latest = await client.query<{ selection_revision: number }>(
        `SELECT selection_revision
           FROM wsgs.world_selection
          WHERE data_scope = $1 AND actor_id = $2 AND principal_id = $3
            AND authorization_context_hash = $4 AND prior_grounding_id = $5
            AND finding_id = $6 AND feature_id = $7
          ORDER BY selection_revision DESC LIMIT 1`,
        [
          input.identity.dataScope,
          input.identity.actorId,
          input.identity.servicePrincipalId,
          input.identity.authorizationContextHash,
          input.request.priorGroundingId,
          input.request.findingId,
          input.request.featureId
        ]
      );
      const result = this.resolver.resolve({
        ...input,
        latestSelectionRevision: latest.rows[0]?.selection_revision ?? 0
      });
      const tokenMetadata = result.upstreamSelectionToken === undefined
        ? undefined
        : structuredSelectionTokenMetadata(result.upstreamSelectionToken);
      await client.query(
        `INSERT INTO wsgs.world_selection(
           selection_id, data_scope, actor_id, principal_id, authorization_context_hash,
           prior_grounding_id, prior_result_hash, finding_id, feature_id,
           selection_revision, source_hash, reference_key, token_key_id, token_hash,
           selection_result_hash, selected_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17)`,
        [
          result.selectionId,
          input.identity.dataScope,
          input.identity.actorId,
          input.identity.servicePrincipalId,
          input.identity.authorizationContextHash,
          result.priorGroundingId,
          result.priorResultHash,
          result.findingId,
          result.featureId,
          result.selectionRevision,
          result.sourceHash,
          result.referenceKey === undefined ? null : JSON.stringify(result.referenceKey),
          tokenMetadata?.keyId ?? null,
          tokenMetadata?.tokenHash ?? null,
          canonicalSha256(result),
          result.selectedAt,
          result.expiresAt
        ]
      );
      return result;
    });
  }
}
