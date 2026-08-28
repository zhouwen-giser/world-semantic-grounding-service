import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { canonicalSha256, type PipelineStageContext } from "@wsgs/grounding-pipeline";
import { stableRecipeIds } from "@wsgs/requirement-planner";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  PRODUCTION_STABLE_OPERATION_IDS,
  assertPriorGroundingReplaySupport,
  buildRecipeOperationInput,
  capabilityCatalogHash,
  canonicalLfSha256,
  computeWorldQueryNodeRequestHashes,
  normalizeReferenceResolution,
  oversizedEvidencePayload,
  persistAcceptedWorldQueryJob,
  selectProductionSouthboundLock
} from "./production-module.js";

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function nearbyPlanning(distanceMm: number | null = 1_000_000): Parameters<typeof buildRecipeOperationInput>[0] {
  const resolveRequirement = {
    requirementId: "requirement-resolve",
    requirementType: "RESOLVE_REFERENCE" as const,
    requiredForProduct: "WORLD_EVIDENCE" as const,
    required: true,
    allowApproximation: false,
    inputs: { mentionNodeIds: ["node-mention-1"], expectedReferenceKinds: ["WORLD_OBJECT"] },
    outputs: ["referenceCandidates"]
  };
  const spatialRequirement = {
    requirementId: "requirement-nearby",
    requirementType: "SPATIAL_NEARBY" as const,
    requiredForProduct: "WORLD_EVIDENCE" as const,
    required: true,
    allowApproximation: false,
    inputs: {
      referenceNodeIds: [],
      spatialConstraints: [{
        sourceNodeId: "node-operation-1",
        operator: "NEAR",
        approximate: false,
        ...(distanceMm === null ? {} : { distanceMm })
      }]
    },
    outputs: ["nearbyCandidates"]
  };
  return {
    recipeId: "REFERENCE_NEARBY",
    planning: {
      status: "PLANNED",
      graph: {
        schemaVersion: "1.0",
        graphId: "requirement-graph-1",
        requirements: [resolveRequirement, spatialRequirement],
        dependencies: [{
          fromRequirementId: resolveRequirement.requirementId,
          toRequirementId: spatialRequirement.requirementId,
          outputName: "referenceCandidates",
          targetPath: "/anchorReferences"
        }],
        graphHash: digest("1")
      },
      selectedRecipeIds: ["REFERENCE_NEARBY"],
      capabilityGaps: []
    },
    groundingGraph: {
      graph: {
        schemaVersion: "1.0",
        nodes: [{
          nodeId: "node-mention-1",
          kind: "MENTION",
          payload: {
            mentionId: "mention-1",
            surfaceText: "2号车",
            expectedKinds: ["WORLD_OBJECT"]
          }
        }],
        edges: []
      }
    } as never,
    references: {
      referenceProducts: [{
        referenceKey: {
          namespace: "gowm",
          kind: "SPATIAL_OBJECT",
          id: `wrf_${"a".repeat(32)}`,
          version: "v1"
        }
      }]
    } as never,
    locale: "zh-CN",
    maximumCandidates: 10
  };
}

function worldQuerySubmission() {
  return {
    requestId: "request-1",
    idempotencyKey: "idem-1",
    plan: {
      queryPlanVersion: "2.0" as const,
      queryId: "query-1",
      nodes: [{
        nodeId: "Node_1",
        operation: {
          operationId: "reference.resolve",
          operationVersion: "1.0",
          inputSchemaHash: digest("1"),
          outputSchemaHash: digest("2")
        },
        inputs: {
          request: {
            kind: "REQUEST_PATH" as const,
            port: {
              schemaUri: "urn:gowm:v0.4:reference-resolve-request",
              schemaHash: digest("1"),
              valueKind: "ANY" as const,
              unitSemantics: "UNSPECIFIED" as const
            },
            path: "/operationInput"
          }
        },
        failurePolicy: "FAIL_FAST" as const,
        budget: {
          maximumRows: 1,
          maximumCandidates: 1,
          maximumOutputBytes: 1024,
          maximumExecutionMs: 1000
        }
      }],
      outputs: [],
      budgets: {
        maximumNodes: 1,
        maximumDepth: 1,
        maximumRows: 1,
        maximumCandidates: 1,
        maximumOutputBytes: 1024,
        maximumExecutionMs: 1000
      }
    },
    parameters: { operationInput: { schemaVersion: "1.0", mentions: [] } },
    parameterSchemaHash: digest("3"),
    snapshotPolicy: { mode: "LATEST_AT_START" as const, allowDowngrade: false as const }
  };
}

describe("production stage module authority boundaries", () => {
  it("hashes a checked-out CRLF lock as its canonical LF bytes", () => {
    const canonical = Buffer.from("{\n  \"schemaVersion\": \"2.0\"\n}\n", "utf8");
    const checkedOut = Buffer.from("{\r\n  \"schemaVersion\": \"2.0\"\r\n}\r\n", "utf8");
    const expected = createHash("sha256").update(canonical).digest("hex");

    expect(canonicalLfSha256(checkedOut)).toBe(expected);
    expect(canonicalLfSha256(canonical)).toBe(expected);
  });

  it("narrows the full consumer catalog to the twelve production stable operations", () => {
    const lock = JSON.parse(readFileSync(resolve(
      import.meta.dirname,
      "..", "..", "..",
      "contracts", "upstream", "gowm-0.6.3", "extracted", "package", "bundle", "locks",
      "wsgs-southbound-operation-lock-v2.json"
    ), "utf8")) as Parameters<typeof selectProductionSouthboundLock>[0];
    const selected = selectProductionSouthboundLock(lock);
    expect(selected.defaultOperations.map((entry) => entry.operationId)).toEqual(PRODUCTION_STABLE_OPERATION_IDS);
    expect(selected.previewOperations).toEqual([]);
    expect(lock.defaultOperations.length + lock.previewOperations.length).toBeGreaterThan(selected.defaultOperations.length);
  });

  it("publishes candidate rank without leaking provider topology", () => {
    const result = normalizeReferenceResolution({
      schemaVersion: "1.0",
      worldVersion: 42,
      resolverVersion: "resolver-1",
      resolutions: [{
        mentionId: "mention-1",
        status: "RESOLVED_EXACT",
        candidates: [{
          candidate: {
            referenceKey: {
              namespace: "gowm",
              kind: "SPATIAL_OBJECT",
              id: `wrf_${"a".repeat(32)}`,
              version: "v1"
            },
            referenceType: "OBJECT",
            displayName: "candidate",
            revalidationRequired: false,
            providerId: "must-not-cross-wsgs-boundary"
          },
          matchedBy: "EXACT_ALIAS",
          matchScore: 0.9,
          providerId: "must-not-cross-wsgs-boundary"
        }]
      }]
    }, [{
      mentionId: "mention-1",
      surfaceText: "candidate",
      span: { encoding: "UTF16_CODE_UNIT", start: 0, end: 9 },
      expectedKinds: ["OBJECT"],
      extractionSources: ["DETERMINISTIC"]
    }]);

    expect(result.referenceProducts[0]?.safeSummary).toEqual({ candidateRank: 0 });
    expect(JSON.stringify(result)).not.toContain("providerId");
    expect(JSON.stringify(result)).not.toContain("providerRank");
  });

  it("keeps catalog identity distinct from the enclosing authority snapshot", () => {
    const catalog = {
      registryVersion: "0.6.3",
      contractCatalogRevision: `sha256:${"1".repeat(64)}`,
      bindingRevision: `sha256:${"2".repeat(64)}`,
      capabilities: []
    } as const;

    expect(capabilityCatalogHash(catalog)).toBe(
      `sha256:${createHash("sha256").update(JSON.stringify({
        bindingRevision: catalog.bindingRevision,
        capabilities: catalog.capabilities,
        contractCatalogRevision: catalog.contractCatalogRevision,
        registryVersion: catalog.registryVersion
      })).digest("hex")}`
    );
    expect(capabilityCatalogHash(catalog)).not.toBe(
      capabilityCatalogHash({ ...catalog, registryVersion: "different" })
    );
  });

  it("fails closed with the prior-grounding typed code when pinned replay is not locked", () => {
    const base = {
      operationVersion: "1.0",
      maturity: "STABLE" as const,
      inputSchemaHash: `sha256:${"1".repeat(64)}` as const,
      outputSchemaHash: `sha256:${"2".repeat(64)}` as const,
      semanticProfileHash: `sha256:${"3".repeat(64)}` as const,
      snapshotSupport: "CONSISTENT_AT_START" as const,
      requiredPermissions: ["data:read"]
    };
    expect(() => assertPriorGroundingReplaySupport([
      { ...base, operationId: "reference.validate" },
      { ...base, operationId: "result.validate" }
    ], 1)).toThrowError(expect.objectContaining({ code: "PINNED_VALIDATION_OPERATION_UNAVAILABLE" }));
    expect(() => assertPriorGroundingReplaySupport([], 0)).not.toThrow();
  });

  it("builds the real reference.resolve shape and converts 1 km from millimetres to metres", () => {
    const result = buildRecipeOperationInput(nearbyPlanning());
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.parameterValues).toEqual({ distanceM: 1_000 });
    expect(result.operationInput).toEqual({
      schemaVersion: "1.0",
      mentions: [{ mentionId: "mention-1", surfaceText: "2号车", expectedKinds: ["WORLD_OBJECT"] }],
      context: {
        anchorReferenceKeys: [{
          namespace: "gowm",
          kind: "SPATIAL_OBJECT",
          id: `wrf_${"a".repeat(32)}`,
          version: "v1"
        }],
        language: "zh-CN"
      },
      limitPerMention: 10
    });

    const schemaRoot = resolve(import.meta.dirname, "..", "..", "..", "contracts", "upstream", "gowm-v0.4");
    const common = JSON.parse(readFileSync(resolve(schemaRoot, "common.schema.json"), "utf8")) as Record<string, unknown>;
    const schema = JSON.parse(readFileSync(resolve(schemaRoot, "reference-resolve-request.schema.json"), "utf8")) as Record<string, unknown>;
    common["$id"] = "https://wsgs.test/common.schema.json";
    schema["$id"] = "https://wsgs.test/reference-resolve-request.schema.json";
    const ajv = new Ajv2020Module.default({ strict: true, strictRequired: false });
    addFormatsModule.default(ajv);
    ajv.addSchema(common);
    expect(ajv.validate(schema, result.operationInput), ajv.errorsText()).toBe(true);
  });

  it.each(stableRecipeIds)("returns a typed gap when %s has no requirement graph inputs", (recipeId) => {
    const base = nearbyPlanning();
    const result = buildRecipeOperationInput({
      ...base,
      recipeId,
      planning: { status: "CAPABILITY_GAP", graph: null, selectedRecipeIds: [recipeId], capabilityGaps: [] }
    });
    expect(result).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: {
        semanticCapability: recipeId,
        reason: "UNSUPPORTED_EXPRESSION",
        blocking: true,
        details: { code: "RECIPE_REQUIREMENT_CHAIN_MISSING" }
      }
    });
  });

  it("returns a typed gap instead of inventing a nearby distance", () => {
    expect(buildRecipeOperationInput(nearbyPlanning(null))).toMatchObject({
      status: "CAPABILITY_GAP",
      gap: { details: { code: "NEARBY_DISTANCE_MM_MISSING_OR_AMBIGUOUS" } }
    });
  });

  it("derives node request hashes from submitted parameters without trusting optional upstream inputHash", () => {
    const submission = worldQuerySubmission();
    const expected = canonicalSha256(submission.parameters.operationInput);
    const hashes = computeWorldQueryNodeRequestHashes(submission, {
      nodes: [{ nodeId: "Node_1", status: "COMPLETED", inputHash: digest("f") }]
    }, [{
      operationId: "reference.resolve",
      operationVersion: "1.0",
      ports: { inputs: [{ name: "request" }], outputs: [] }
    }] as never);
    expect(hashes).toEqual({ Node_1: expected });
    expect(hashes["Node_1"]).not.toBe(digest("f"));
  });

  it("reconstructs a linked nearby node input from the submitted radius and actual upstream geometry", () => {
    const submission = worldQuerySubmission();
    submission.parameters["distanceM"] = 1_000;
    submission.plan.nodes.push({
      nodeId: "Node_2",
      operation: {
        operationId: "spatial.find-nearby",
        operationVersion: "1.0",
        inputSchemaHash: digest("5"),
        outputSchemaHash: digest("6")
      },
      inputs: {
        location: {
          kind: "NODE_OUTPUT",
          port: {
            schemaUri: "urn:test:geometry",
            schemaHash: digest("7"),
            valueKind: "GEOMETRY",
            unitSemantics: "ANGULAR_DEGREES"
          },
          nodeId: "Node_1",
          outputPort: "geometry",
          path: "/facts/0/geometry",
          targetPath: "/location"
        },
        radiusM: {
          kind: "REQUEST_PATH",
          port: {
            schemaUri: "urn:gowm:v0.2:value:number",
            schemaHash: digest("8"),
            valueKind: "ANY",
            unitSemantics: "UNSPECIFIED"
          },
          path: "/distanceM",
          targetPath: "/radiusM"
        }
      },
      failurePolicy: "FAIL_FAST",
      budget: {
        maximumRows: 1,
        maximumCandidates: 1,
        maximumOutputBytes: 1024,
        maximumExecutionMs: 1000
      }
    });
    const geometry = { type: "Point", coordinates: [116.4, 39.9] };
    const hashes = computeWorldQueryNodeRequestHashes(submission, {
      nodes: [{
        nodeId: "Node_1",
        status: "COMPLETED",
        result: { output: { value: { facts: [{ geometry }] } } }
      }, { nodeId: "Node_2", status: "COMPLETED" }]
    }, [{
      operationId: "reference.resolve",
      operationVersion: "1.0",
      ports: {
        inputs: [{ name: "request" }],
        outputs: [{ name: "geometry", path: "/facts/0/geometry" }]
      }
    }, {
      operationId: "spatial.find-nearby",
      operationVersion: "1.0",
      ports: { inputs: [{ name: "request" }], outputs: [] }
    }] as never);
    expect(hashes["Node_2"]).toBe(canonicalSha256({ location: geometry, radiusM: 1_000 }));
  });

  it("detects evidence that needs unavailable object storage before normalization", () => {
    expect(oversizedEvidencePayload({ outputs: { value: "x".repeat(128) }, nodes: [] }, 32)).toMatchObject({
      path: "WORLD_QUERY_OUTPUTS"
    });
    expect(oversizedEvidencePayload({ outputs: { value: "small" }, nodes: [] }, 128)).toBeNull();
  });

  it("persists an accepted async GOWM job under the worker fence", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, ...(values ? { values } : {}) });
        return { rowCount: /^\s*SELECT/u.test(sql) || /^\s*UPDATE/u.test(sql) ? 1 : null, rows: [] };
      },
      release: () => undefined
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const context = {
      jobId: "job-1",
      leaseToken: "lease-1",
      groundingId: "grounding-1",
      operation: "EXECUTE_WORLD_QUERY",
      generation: 7,
      stage: "GOWM_EXECUTE",
      attempt: 1,
      stageExecutionId: "stage-execution-1",
      runFingerprint: digest("4"),
      deadlineAt: new Date(Date.now() + 60_000),
      immutableLocks: {},
      state: {},
      signal: new AbortController().signal
    } satisfies PipelineStageContext;
    const submission = worldQuerySubmission();
    await persistAcceptedWorldQueryJob(context, pool, submission, {
      jobId: "gateway-job-1",
      queryId: "gateway-query-1",
      status: "QUEUED"
    });
    const update = queries.find((entry) => /^\s*UPDATE/u.test(entry.sql));
    expect(update?.values).toEqual([
      "query-1", "gateway-query-1", "gateway-job-1", "QUEUED", "grounding-1"
    ]);
    expect(queries.some((entry) => entry.sql.includes("lease_token = $2") && entry.sql.includes("stage_generation = $3"))).toBe(true);
  });
});
