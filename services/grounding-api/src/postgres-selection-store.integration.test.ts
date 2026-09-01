import { resolve } from "node:path";

import { createGroundingIdentity } from "@wsgs/delegated-identity";
import {
  StructuredSelectionError,
  StructuredSelectionTokenCodec,
  StructuredWorldSelectionResolver,
  type PriorGroundingResult,
  type ResolveWorldSelectionRequest
} from "@wsgs/structured-world-selection";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, runAssertions } from "../../../packages/runtime/src/migrations.js";
import { PostgresStructuredSelectionStore } from "./postgres-selection-store.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const integration = databaseUrl ? describe.sequential : describe.skip;
const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64)}`;
const sourceHash = digest("a");
const resultHash = digest("b");
const identity = createGroundingIdentity({
  servicePrincipalId: "sacs-selection-service",
  actorId: "selection-actor",
  dataScopes: ["selection-scope"],
  datasetScopes: ["selection-dataset"],
  permissions: ["grounding.read"]
});
const scopedIdentity = { ...identity, dataScope: "selection-scope" };
const request: ResolveWorldSelectionRequest = {
  schemaVersion: "wsgs-structured-selection-request/1.0",
  priorGroundingId: "grounding-selection-parent",
  priorResultHash: resultHash,
  findingId: "finding-selection",
  featureId: "feature-selection",
  selectionRevision: 1,
  sourceHash
};
const priorResult: PriorGroundingResult = {
  groundingId: request.priorGroundingId,
  resultHash,
  geospatialFindings: {
    findings: [{
      findingId: request.findingId,
      sourceProductIds: ["source-selection"],
      features: [{ featureId: request.featureId, geometry: { type: "Point", coordinates: [0, 0] } }]
    }],
    sourceProducts: [{ sourceProductId: "source-selection", contentHash: sourceHash }]
  }
};

function resolver(): StructuredWorldSelectionResolver {
  return new StructuredWorldSelectionResolver(new StructuredSelectionTokenCodec({
    activeKeyId: "selection-key",
    keys: [{ keyId: "selection-key", key: new Uint8Array(32).fill(7) }],
    ttlMs: 300_000,
    now: () => Date.parse("2027-01-15T08:00:00.000Z"),
    randomBytes: (size) => new Uint8Array(size).fill(3)
  }), () => Date.parse("2027-01-15T08:00:00.000Z"));
}

integration("N07 PostgreSQL structured selection persistence", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const root = resolve(import.meta.dirname, "..", "..", "..");

  beforeAll(async () => {
    await applyMigrations(pool, resolve(root, "database", "migrations"));
    await runAssertions(pool, resolve(root, "database", "assertions"));
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE TABLE wsgs.world_selection, wsgs.source_currentness_validation,
      wsgs.grounding_result, wsgs.grounding_request CASCADE`);
    await pool.query(
      `INSERT INTO wsgs.grounding_request(
         grounding_id, request_id, data_scope, actor_id, dataset_scopes,
         authorization_context_hash, principal_id, payload_hash, source_text_sha256,
         source_expires_at, request_metadata
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,'{}'::jsonb)`,
      [
        request.priorGroundingId,
        "request-selection-parent",
        scopedIdentity.dataScope,
        scopedIdentity.actorId,
        JSON.stringify(scopedIdentity.datasetScopes),
        scopedIdentity.authorizationContextHash,
        scopedIdentity.servicePrincipalId,
        digest("c"),
        digest("d"),
        new Date("2027-01-16T08:00:00.000Z")
      ]
    );
    await pool.query(
      `INSERT INTO wsgs.grounding_result(
         grounding_id, data_scope, actor_id, status, result_hash, result_bytes,
         contract_version, result_profile, contract_selection_hash
       ) VALUES ($1,$2,$3,'COMPLETED',$4,$5,
         'sacs-wsgs-grounding/1.1','sacs-wsgs-geospatial-findings/1.0',$6)`,
      [
        request.priorGroundingId,
        scopedIdentity.dataScope,
        scopedIdentity.actorId,
        resultHash,
        Buffer.from(JSON.stringify({ resultHash }), "utf8"),
        digest("e")
      ]
    );
  });

  afterAll(async () => pool.end());

  it("allocates durable revisions, stores token metadata only, and resumes after restart", async () => {
    const first = await new PostgresStructuredSelectionStore(pool, resolver()).resolve({
      identity: scopedIdentity,
      request,
      priorResult
    });
    expect(first.upstreamSelectionToken).toMatch(/^wsgs\.sel\.v1\.selection-key\./u);
    const stored = await pool.query<{
      selection_revision: number;
      token_key_id: string;
      token_hash: string;
      reference_key: unknown;
    }>(`SELECT selection_revision, token_key_id, token_hash, reference_key
          FROM wsgs.world_selection WHERE selection_id = $1`, [first.selectionId]);
    expect(stored.rows[0]).toEqual({
      selection_revision: 1,
      token_key_id: "selection-key",
      token_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      reference_key: null
    });
    expect(JSON.stringify(stored.rows[0])).not.toContain(first.upstreamSelectionToken);

    const second = await new PostgresStructuredSelectionStore(pool, resolver()).resolve({
      identity: scopedIdentity,
      request: { ...request, selectionRevision: 2 },
      priorResult
    });
    expect(second.selectionRevision).toBe(2);
    expect((await pool.query("SELECT 1 FROM wsgs.world_selection")).rowCount).toBe(2);
  });

  it("rejects foreign authority before revision or token persistence", async () => {
    await expect(new PostgresStructuredSelectionStore(pool, resolver()).resolve({
      identity: { ...scopedIdentity, servicePrincipalId: "foreign-selection-service" },
      request,
      priorResult
    })).rejects.toMatchObject({ code: "SELECTION_NOT_FOUND" } satisfies Partial<StructuredSelectionError>);
    expect((await pool.query("SELECT 1 FROM wsgs.world_selection")).rowCount).toBe(0);
  });
});
