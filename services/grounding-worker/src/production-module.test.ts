import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { DeterministicParseResult } from "@wsgs/deterministic-parser";
import { canonicalSha256, type PipelineStageContext } from "@wsgs/grounding-pipeline";
import { TypedWorldQueryCompiler, canonicalPlanHash } from "@wsgs/query-compiler";
import { stableRecipeIds } from "@wsgs/requirement-planner";
import type { GdpsLockedRecipe } from "@wsgs/trusted-capability-snapshot";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  PRODUCTION_STABLE_OPERATION_IDS,
  PRODUCTION_WORLD_QUERY_SNAPSHOT_POLICY,
  applyReferenceValidation,
  assertPriorGroundingReplaySupport,
  augmentGroundingGraphWithCurrentness,
  buildRecipeOperationInput,
  capabilityCatalogHash,
  canonicalLfSha256,
  compileGdpsBestEffortCurrentSource,
  computeWorldQueryNodeRequestHashes,
  executeGdpsSequentialCurrentSource,
  gdpsSourceChangedAttemptRecord,
  isGdpsSourceChangedDuringQuery,
  mergeKnownReferenceProducts,
  loadPriorCurrentnessContexts,
  normalizeGdpsCurrentnessWorldQuery,
  normalizeGdpsWorldQuerySources,
  normalizeReferenceResolution,
  normalizeValidation,
  oversizedEvidencePayload,
  persistAcceptedWorldQueryJob,
  productionReferenceMentions,
  referenceMentionsRequiringResolution,
  recognizeGdpsPriorCurrentnessReplay,
  selectProductionSouthboundLock
} from "./production-module.js";
import { authorizeGdps, compileInput } from "../../../packages/query-compiler/src/test-fixtures.js";

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function lockedRecipe(entry: Parameters<typeof selectProductionSouthboundLock>[0]["previewOperations"][number]): GdpsLockedRecipe {
  return {
    schemaVersion: "wsgs-locked-gdps-recipe/2.0",
    recipeId: "recipe-gdps-land-cover-at-reference",
    semanticPattern: "GDPS_LAND_COVER_AT_REFERENCE",
    requirementType: "READ_LAND_COVER",
    descriptorConstraint: { descriptorId: "LAND_COVER", descriptorHash: digest("d") },
    queryProfile: null,
    previewAuthorizationRequired: true,
    maturityPolicy: { allowed: "PREVIEW", requiresExactHashes: true },
    productIdPolicy: "UNBOUND_UNLESS_EXPLICIT",
    inputBindings: {},
    outputSemantics: { currentOnly: true },
    allowedOperations: [{
      operationId: entry.operationId,
      operationVersion: entry.operationVersion,
      inputSchemaHash: entry.inputSchemaHash,
      outputSchemaHash: entry.outputSchemaHash,
      semanticProfileHash: entry.semanticProfileHash
    }]
  };
}

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

function currentnessReplay() {
  return {
    sourceGroundingId: "grounding-prior-slope",
    sourceResultHash: digest("1"),
    selectedEvidenceProductId: "evidence-prior-slope",
    productId: "gdps-slope-prior",
    contentHash: digest("2"),
    sourceOperation: "geo-raster.sample",
    sourceOperationVersion: "1.0",
    sourceRecipeId: "recipe-gdps-generic-sample-value",
    sourceRecipeLockHash: digest("3"),
    descriptorId: "SLOPE/DEGREE",
    descriptorHash: digest("4"),
    productType: "SLOPE",
    productProfile: "DEGREE",
    queryProfile: "SAMPLE_VALUE",
    replayMode: "STRICT" as const,
    sourceGatewayQueryId: "query-prior-slope",
    sourceOperationLockHash: digest("a")
  };
}

function currentnessAuthorization() {
  return {
    recipeId: "gdps-check-current-geo-product" as const,
    requirementKind: "CHECK_CURRENT_GEO_PRODUCT" as const,
    providerRecipeLockHash: digest("5"),
    operationLockHash: digest("6"),
    allowedOperation: {
      operationId: "geo-product.check-current" as const,
      operationVersion: "1.0" as const,
      inputSchemaHash: digest("7"),
      outputSchemaHash: digest("8"),
      semanticProfileHash: digest("9")
    }
  };
}

function currentnessWorldQueryFixture(
  currentness: "CURRENT" | "CHANGED" | "NOT_AVAILABLE",
  currentContentHash?: `sha256:${string}`,
  replayMode: "STRICT" | "BEST_EFFORT" = "STRICT"
) {
  const replay = { ...currentnessReplay(), replayMode };
  const authorization = currentnessAuthorization();
  const nodeId = "Node_1";
  const base = worldQuerySubmission();
  const submission = {
    ...base,
    plan: {
      ...base.plan,
      nodes: [{
        ...base.plan.nodes[0]!,
        nodeId,
        operation: {
          operationId: "geo-product.check-current",
          operationVersion: "1.0",
          inputSchemaHash: authorization.allowedOperation.inputSchemaHash,
          outputSchemaHash: authorization.allowedOperation.outputSchemaHash
        }
      }]
    },
    parameters: {
      productId: replay.productId,
      contentHash: replay.contentHash,
      replayMode,
      sourceGroundingId: replay.sourceGroundingId,
      sourceResultHash: replay.sourceResultHash,
      currentnessRecipeId: authorization.recipeId,
      currentnessProviderRecipeLockHash: authorization.providerRecipeLockHash,
      currentnessOperationLockHash: authorization.operationLockHash
    }
  };
  return {
    replay,
    authorization,
    submission,
    operation: {
      ...authorization.allowedOperation,
      maturity: "PREVIEW" as const,
      snapshotSupport: "CONSISTENT_AT_START" as const,
      requiredPermissions: ["data:read"]
    },
    worldValue: {
      nodes: [{
        nodeId,
        status: "COMPLETED",
        result: {
          operation: { operationId: "geo-product.check-current", operationVersion: "1.0" },
          status: "COMPLETED",
          output: {
            schemaHash: authorization.allowedOperation.outputSchemaHash,
            value: {
              productId: replay.productId,
              currentness,
              ...(currentContentHash ? { currentContentHash } : {})
            }
          },
          computeSnapshot: {
            operation: { operationId: "geo-product.check-current" },
            schemas: {
              inputSchemaHash: authorization.allowedOperation.inputSchemaHash,
              outputSchemaHash: authorization.allowedOperation.outputSchemaHash
            }
          }
        }
      }]
    }
  };
}

function bestEffortSourceFixture() {
  const sourceInput = authorizeGdps(compileInput("GDPS_GENERIC_SAMPLE_VALUE"), {
    descriptorId: "SLOPE/DEGREE",
    descriptorHash: digest("4"),
    productType: "SLOPE",
    productProfile: "DEGREE"
  });
  sourceInput.maturityPolicy.allowPreview = true;
  sourceInput.parameterValues = {
    ...sourceInput.parameterValues,
    queryProfile: "SAMPLE_VALUE"
  };
  sourceInput.snapshotPolicy = { mode: "LATEST_AT_START", allowDowngrade: false };
  const sourceCompiled = new TypedWorldQueryCompiler().compile(sourceInput);
  if (sourceCompiled.status !== "COMPILED" || !sourceInput.gdpsRecipeAuthorization ||
      !sourceInput.trustedGdpsRecipeLockHash) {
    throw new Error("TEST_SOURCE_QUERY_DID_NOT_COMPILE");
  }
  const replay = {
    ...currentnessReplay(),
    replayMode: "BEST_EFFORT" as const,
    sourceGatewayQueryId: sourceCompiled.submission.plan.queryId,
    sourceRecipeLockHash: sourceInput.trustedGdpsRecipeLockHash,
    sourceOperationLockHash: digest("a")
  };
  const recipe: GdpsLockedRecipe = {
    schemaVersion: "wsgs-locked-gdps-recipe/2.0",
    recipeId: replay.sourceRecipeId,
    semanticPattern: "GDPS_GENERIC_SAMPLE_VALUE",
    requirementType: "READ_GEO_PRODUCT_VALUE",
    descriptorConstraint: null,
    queryProfile: replay.queryProfile,
    previewAuthorizationRequired: true,
    maturityPolicy: { allowed: "PREVIEW", requiresExactHashes: true },
    productIdPolicy: "UNBOUND_UNLESS_EXPLICIT",
    inputBindings: {},
    outputSemantics: { currentOnly: true },
    allowedOperations: sourceInput.gdpsRecipeAuthorization.allowedOperations
  };
  return {
    replay,
    persistedSource: {
      sourceGroundingId: replay.sourceGroundingId,
      sourceGatewayQueryId: replay.sourceGatewayQueryId,
      sourcePlanHash: sourceCompiled.planHash,
      submission: sourceCompiled.submission
    },
    compileOptions: {
      replay,
      persistedSource: {
        sourceGroundingId: replay.sourceGroundingId,
        sourceGatewayQueryId: replay.sourceGatewayQueryId,
        sourcePlanHash: sourceCompiled.planHash,
        submission: sourceCompiled.submission
      },
      attempt: 1 as const,
      requestId: "request-current",
      idempotencyKey: "idempotency-current",
      requiredForProduct: "WORLD_EVIDENCE",
      parameterSchemaHash: sourceInput.parameterSchemaHash,
      capabilities: sourceInput.capabilities,
      semanticProfiles: sourceInput.semanticProfiles,
      operationLocks: sourceInput.operationLocks,
      operationLockHash: replay.sourceOperationLockHash,
      availability: sourceInput.availability,
      allowPreview: true,
      observedAt: sourceInput.observedAt!,
      budgets: sourceInput.budgets,
      recipeLock: {
        lock: {
          schemaVersion: "wsgs-gdps-recipe-lock/2.0" as const,
          providerId: "gdps.geospatial-products" as const,
          providerVersion: "0.2.1",
          descriptorRegistryHash: digest("descriptor-registry"),
          productTypeCount: 34 as const,
          profileCount: 35 as const,
          capabilityLockHash: digest("capability-lock"),
          recipes: [recipe]
        },
        lockHash: replay.sourceRecipeLockHash
      }
    }
  };
}

describe("production stage module authority boundaries", () => {
  it("uses per-node best effort for mixed world-independent and snapshot-bound DAGs", () => {
    expect(PRODUCTION_WORLD_QUERY_SNAPSHOT_POLICY).toEqual({
      mode: "BEST_EFFORT",
      allowDowngrade: false
    });
  });

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

  it("admits only the PREVIEW operation selected by an exact GDPS recipe", () => {
    const lock = JSON.parse(readFileSync(resolve(
      import.meta.dirname,
      "..", "..", "..",
      "contracts", "upstream", "gowm-0.6.3", "extracted", "package", "bundle", "locks",
      "wsgs-southbound-operation-lock-v2.json"
    ), "utf8")) as Parameters<typeof selectProductionSouthboundLock>[0];
    const template = lock.previewOperations[0]!;
    lock.previewOperations.push({
      ...template,
      operationId: "landcover.get-class",
      operationVersion: "1.0",
      maturity: "PREVIEW"
    });

    const selected = selectProductionSouthboundLock(lock, [lockedRecipe(lock.previewOperations.at(-1)!)]);

    expect(selected.previewOperations.map((entry) => `${entry.operationId}@${entry.operationVersion}`))
      .toEqual(["landcover.get-class@1.0"]);
  });

  it("fails closed when an enabled GDPS recipe is absent from the exact lock", () => {
    const lock = JSON.parse(readFileSync(resolve(
      import.meta.dirname,
      "..", "..", "..",
      "contracts", "upstream", "gowm-0.6.3", "extracted", "package", "bundle", "locks",
      "wsgs-southbound-operation-lock-v2.json"
    ), "utf8")) as Parameters<typeof selectProductionSouthboundLock>[0];

    const missing = lockedRecipe({ ...lock.previewOperations[0]!, operationId: "landcover.get-class", operationVersion: "1.0" });
    expect(() => selectProductionSouthboundLock(lock, [missing]))
      .toThrow("PRODUCTION_PREVIEW_OPERATION_LOCK_MISSING_landcover.get-class");
  });

  it("admits currentness only when the PREVIEW operation matches the exact provider authority", () => {
    const lock = JSON.parse(readFileSync(resolve(
      import.meta.dirname,
      "..", "..", "..",
      "contracts", "upstream", "gowm-0.6.3", "extracted", "package", "bundle", "locks",
      "wsgs-southbound-operation-lock-v2.json"
    ), "utf8")) as Parameters<typeof selectProductionSouthboundLock>[0];
    const authorization = currentnessAuthorization();
    lock.previewOperations.push({
      ...lock.previewOperations[0]!,
      ...authorization.allowedOperation,
      maturity: "PREVIEW",
      snapshotSupport: "CONSISTENT_AT_START"
    });
    expect(selectProductionSouthboundLock(lock, [], authorization).previewOperations).toEqual([
      expect.objectContaining({
        operationId: "geo-product.check-current",
        operationVersion: "1.0",
        snapshotSupport: "CONSISTENT_AT_START"
      })
    ]);
    const drifted = structuredClone(authorization);
    drifted.allowedOperation.outputSchemaHash = digest("0");
    expect(() => selectProductionSouthboundLock(lock, [], drifted))
      .toThrow("PRODUCTION_PREVIEW_OPERATION_LOCK_DRIFT_geo-product.check-current");
  });

  it.each(["NONE", "BEST_EFFORT", "PINNED"] as const)(
    "rejects %s snapshot support for the exact current-source check",
    (snapshotSupport) => {
      const lock = JSON.parse(readFileSync(resolve(
        import.meta.dirname,
        "..", "..", "..",
        "contracts", "upstream", "gowm-0.6.3", "extracted", "package", "bundle", "locks",
        "wsgs-southbound-operation-lock-v2.json"
      ), "utf8")) as Parameters<typeof selectProductionSouthboundLock>[0];
      const authorization = currentnessAuthorization();
      lock.previewOperations.push({
        ...lock.previewOperations[0]!,
        ...authorization.allowedOperation,
        maturity: "PREVIEW",
        snapshotSupport
      });
      expect(() => selectProductionSouthboundLock(lock, [], authorization))
        .toThrow("PRODUCTION_CURRENTNESS_SNAPSHOT_SUPPORT_INVALID");
    }
  );

  it("normalizes a GDPS world-query node with the exact recipe and descriptor authority", () => {
    const operation = {
      operationId: "geo-raster.sample",
      operationVersion: "1.0",
      inputSchemaHash: digest("1"),
      outputSchemaHash: digest("2"),
      semanticProfileHash: digest("3")
    } as const;
    const recipe: GdpsLockedRecipe = {
      schemaVersion: "wsgs-locked-gdps-recipe/2.0",
      recipeId: "recipe-gdps-generic-sample-value",
      semanticPattern: "GDPS_GENERIC_SAMPLE_VALUE",
      requirementType: "READ_GEO_PRODUCT_VALUE",
      descriptorConstraint: null,
      queryProfile: "SAMPLE_VALUE_OR_CLASS",
      previewAuthorizationRequired: true,
      maturityPolicy: { allowed: "PREVIEW", requiresExactHashes: true },
      productIdPolicy: "UNBOUND_UNLESS_EXPLICIT",
      inputBindings: {},
      outputSemantics: { currentOnly: true },
      allowedOperations: [operation]
    };
    const base = worldQuerySubmission();
    const submission = {
      ...base,
      plan: {
        ...base.plan,
        nodes: [{ ...base.plan.nodes[0]!, nodeId: "Node_3", operation }]
      },
      parameters: {
        ...base.parameters,
        descriptorId: "SLOPE/DEGREE",
        descriptorHash: digest("4"),
        productType: "SLOPE",
        productProfile: "DEGREE",
        queryProfile: "SAMPLE_VALUE"
      }
    };
    const source = normalizeGdpsWorldQuerySources(submission, {
      nodes: [{
        nodeId: "Node_3",
        result: {
          operation: { operationId: operation.operationId, operationVersion: operation.operationVersion },
          status: "COMPLETED",
          output: { value: { productId: "slope-main", contentHash: digest("5"), truncated: false } },
          dataSnapshot: { digest: digest("6") },
          computeSnapshot: { digest: digest("7") },
          receipts: [{ receiptId: "gdps-receipt-1" }],
          evidenceReferences: [{ evidenceId: "gdps-evidence-1" }]
        }
      }]
    }, {
      lock: {
        schemaVersion: "wsgs-gdps-recipe-lock/2.0",
        providerId: "gdps.geospatial-products",
        providerVersion: "0.2.1",
        descriptorRegistryHash: digest("8"),
        productTypeCount: 34,
        profileCount: 35,
        capabilityLockHash: digest("9"),
        recipes: [recipe]
      },
      lockHash: digest("a")
    });
    expect(source).toMatchObject([{
      nodeId: "Node_3",
      evidence: {
        recipeId: recipe.recipeId,
        recipeLockHash: digest("a"),
        descriptorId: "SLOPE/DEGREE",
        descriptorHash: digest("4"),
        productId: "slope-main",
        contentHash: digest("5"),
        normalizedStatus: "COMPLETED",
        receiptIds: ["gdps-receipt-1"],
        evidenceIds: ["gdps-evidence-1"]
      }
    }]);
  });

  it("recognizes only a persisted, selected GDPS current-product identity", () => {
    const replay = currentnessReplay();
    const resultBytes = Buffer.from(JSON.stringify({
      groundingId: replay.sourceGroundingId,
      resultHash: replay.sourceResultHash,
      evidenceItems: [{
        evidenceProductId: replay.selectedEvidenceProductId,
        productKind: "CAPABILITY_RESULT",
        sourceOperation: replay.sourceOperation,
        safePayload: { productId: replay.productId, contentHash: replay.contentHash }
      }]
    }), "utf8");
    const recognized = recognizeGdpsPriorCurrentnessReplay({
      sourceGroundingId: replay.sourceGroundingId,
      sourceResultHash: replay.sourceResultHash,
      selectedProductIds: [replay.selectedEvidenceProductId],
      resultBytes,
      sourceOperationLockHash: replay.sourceOperationLockHash,
      executions: [{
        execution_kind: "WORLD_QUERY_NODE",
        operation_id: replay.sourceOperation,
        operation_version: "1.0",
        gateway_query_id: replay.sourceGatewayQueryId,
        request_hash: digest("request"),
        data_snapshot: {
          gdpsSourceEvidence: {
            productId: replay.productId,
            contentHash: replay.contentHash,
            recipeId: replay.sourceRecipeId,
            recipeLockHash: replay.sourceRecipeLockHash,
            descriptorId: replay.descriptorId,
            descriptorHash: replay.descriptorHash,
            productType: replay.productType,
            productProfile: replay.productProfile,
            queryProfile: replay.queryProfile
          }
        }
      }]
    });
    expect(recognized).toEqual(replay);
    expect(() => recognizeGdpsPriorCurrentnessReplay({
      sourceGroundingId: replay.sourceGroundingId,
      sourceResultHash: replay.sourceResultHash,
      selectedProductIds: [replay.selectedEvidenceProductId],
      resultBytes,
      sourceOperationLockHash: replay.sourceOperationLockHash,
      executions: []
    })).toThrow("PRIOR_GDPS_EXECUTION_EVIDENCE_AMBIGUOUS");
  });

  it("injects a non-executable prior product marker and builds only check-current input", () => {
    const replay = currentnessReplay();
    const augmented = augmentGroundingGraphWithCurrentness({
      graph: { schemaVersion: "1.0", nodes: [], edges: [] },
      graphHash: digest("a"),
      mergedMentions: [],
      ambiguities: [],
      completionStatus: "COMPLETE",
      warnings: []
    }, [replay]);
    const priorNode = augmented.graph.nodes[0]!;
    const validateReference = {
      requirementId: "requirement-currentness-reference",
      requirementType: "VALIDATE_REFERENCE" as const,
      requiredForProduct: "WORLD_EVIDENCE" as const,
      required: true,
      allowApproximation: false,
      inputs: { referenceNodeIds: [] },
      outputs: ["validatedReferences"]
    };
    const validateResult = {
      requirementId: "requirement-currentness-result",
      requirementType: "VALIDATE_RESULT" as const,
      requiredForProduct: "WORLD_EVIDENCE" as const,
      required: true,
      allowApproximation: false,
      inputs: { resultNodeIds: [priorNode.nodeId] },
      outputs: ["validatedResult"]
    };
    const built = buildRecipeOperationInput({
      recipeId: "PRIOR_RESULT_REVALIDATION",
      planning: {
        status: "PLANNED",
        graph: {
          schemaVersion: "1.0",
          graphId: "requirements-currentness",
          requirements: [validateReference, validateResult],
          dependencies: [{
            fromRequirementId: validateReference.requirementId,
            toRequirementId: validateResult.requirementId,
            outputName: "validatedReferences",
            targetPath: "/result"
          }],
          graphHash: digest("b")
        },
        selectedRecipeIds: ["PRIOR_RESULT_REVALIDATION"],
        capabilityGaps: []
      },
      groundingGraph: augmented,
      references: normalizeReferenceResolution(null, []),
      maximumCandidates: 10
    });
    expect(built).toMatchObject({
      status: "READY",
      operationInput: { productId: replay.productId, contentHash: replay.contentHash },
      parameterValues: {
        replayMode: "STRICT",
        sourceOperation: "geo-raster.sample",
        descriptorId: "SLOPE/DEGREE"
      }
    });
    expect(JSON.stringify(augmented.graph)).not.toContain("operationInput");
  });

  it("maps a real-shaped CHANGED currentness output to strict SNAPSHOT_MISMATCHED", () => {
    const replay = currentnessReplay();
    const authorization = currentnessAuthorization();
    const nodeId = "Node_1";
    const submission = {
      ...worldQuerySubmission(),
      plan: {
        ...worldQuerySubmission().plan,
        nodes: [{
          ...worldQuerySubmission().plan.nodes[0]!,
          nodeId,
          operation: {
            operationId: "geo-product.check-current",
            operationVersion: "1.0",
            inputSchemaHash: authorization.allowedOperation.inputSchemaHash,
            outputSchemaHash: authorization.allowedOperation.outputSchemaHash
          }
        }]
      },
      parameters: {
        productId: replay.productId,
        contentHash: replay.contentHash,
        replayMode: "STRICT",
        sourceGroundingId: replay.sourceGroundingId,
        sourceResultHash: replay.sourceResultHash,
        currentnessRecipeId: authorization.recipeId,
        currentnessProviderRecipeLockHash: authorization.providerRecipeLockHash,
        currentnessOperationLockHash: authorization.operationLockHash
      }
    };
    const currentContentHash = digest("c");
    const result = normalizeGdpsCurrentnessWorldQuery({
      submission,
      replay,
      authorization,
      operation: {
        ...authorization.allowedOperation,
        maturity: "PREVIEW",
        snapshotSupport: "CONSISTENT_AT_START",
        requiredPermissions: ["data:read"]
      },
      worldValue: {
        nodes: [{
          nodeId,
          status: "COMPLETED",
          result: {
            operation: { operationId: "geo-product.check-current", operationVersion: "1.0" },
            status: "COMPLETED",
            output: {
              schemaHash: authorization.allowedOperation.outputSchemaHash,
              value: { productId: replay.productId, currentness: "CHANGED", currentContentHash }
            },
            computeSnapshot: {
              operation: { operationId: "geo-product.check-current" },
              schemas: {
                inputSchemaHash: authorization.allowedOperation.inputSchemaHash,
                outputSchemaHash: authorization.allowedOperation.outputSchemaHash
              }
            }
          }
        }]
      }
    });
    expect(result).toEqual({
      nodeId,
      currentness: "CHANGED",
      currentContentHash,
      decision: {
        status: "SNAPSHOT_MISMATCHED",
        mode: "STRICT",
        source: { productId: replay.productId, contentHash: replay.contentHash },
        actualContentHash: currentContentHash,
        executionBlocked: true,
        warnings: ["SOURCE_CHANGED"]
      }
    });
  });

  it("allows only the same current product identity in STRICT mode", () => {
    const replay = currentnessReplay();
    const result = normalizeGdpsCurrentnessWorldQuery(
      currentnessWorldQueryFixture("CURRENT", replay.contentHash)
    );
    expect(result).toMatchObject({
      currentness: "CURRENT",
      decision: {
        status: "REPLAY_ALLOWED",
        mode: "STRICT",
        source: { productId: replay.productId, contentHash: replay.contentHash },
        warnings: []
      }
    });
  });

  it("maps a missing current product to an unresolved data gap in STRICT mode", () => {
    const result = normalizeGdpsCurrentnessWorldQuery(currentnessWorldQueryFixture("NOT_AVAILABLE"));
    expect(result).toMatchObject({
      currentness: "NOT_AVAILABLE",
      decision: {
        status: "UNRESOLVED",
        mode: "STRICT",
        gapKind: "DATA_GAP",
        executionBlocked: true,
        warnings: ["SOURCE_NOT_AVAILABLE"]
      }
    });
  });

  it("maps CHANGED to SOURCE_ADVANCED only under explicit BEST_EFFORT", () => {
    const currentContentHash = digest("c");
    const result = normalizeGdpsCurrentnessWorldQuery(
      currentnessWorldQueryFixture("CHANGED", currentContentHash, "BEST_EFFORT")
    );
    expect(result).toMatchObject({
      currentness: "CHANGED",
      currentContentHash,
      decision: {
        status: "REPLAY_ALLOWED",
        mode: "BEST_EFFORT",
        source: { productId: currentnessReplay().productId, contentHash: currentContentHash },
        priorContentHash: currentnessReplay().contentHash,
        warnings: ["SOURCE_ADVANCED"]
      }
    });
  });

  it("recompiles a persisted source recipe as a new exact current-source query", () => {
    const fixture = bestEffortSourceFixture();
    const result = compileGdpsBestEffortCurrentSource(fixture.compileOptions);
    expect(result.submission.requestId).toMatch(/^wsgs-refresh-[0-9a-f]{32}$/u);
    expect(result.submission.requestId).not.toBe(fixture.persistedSource.submission.requestId);
    expect(result.submission.plan.queryId).not.toBe(fixture.persistedSource.submission.plan.queryId);
    expect(result.submission.idempotencyKey).toBe("idempotency-current:gdps-current-source:1");
    expect(result.submission.snapshotPolicy).toEqual({ mode: "LATEST_AT_START", allowDowngrade: false });
    expect(result.submission.plan.nodes.map((entry) => entry.operation.operationId)).toEqual(
      fixture.persistedSource.submission.plan.nodes.map((entry) => entry.operation.operationId)
    );
    expect(result.submission.plan.nodes.filter((entry) => entry.operation.operationId === "geo-raster.sample"))
      .toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("geo-product.check-current");
    expect(result.submission.parameters["operationInput"]).toEqual(
      fixture.persistedSource.submission.parameters["operationInput"]
    );
    expect(canonicalPlanHash(result.submission.plan)).toBe(result.planHash);
  });

  it("never carries historical payload or unknown persisted parameters into the current-source query", () => {
    const fixture = bestEffortSourceFixture();
    const injected = structuredClone(fixture.compileOptions);
    injected.persistedSource.submission.parameters["historicalRasterPayload"] = {
      type: "FeatureCollection", features: [{ secretHistoricalValue: 1 }]
    };
    expect(() => compileGdpsBestEffortCurrentSource(injected))
      .toThrow("GDPS_BEST_EFFORT_SOURCE_PARAMETER_NOT_AUTHORIZED");
    const clean = compileGdpsBestEffortCurrentSource(fixture.compileOptions);
    expect(JSON.stringify(clean)).not.toContain("secretHistoricalValue");
    expect(JSON.stringify(clean)).not.toContain("historicalRasterPayload");
  });

  it("executes CHANGED as one new source query and never executes it for NOT_AVAILABLE or STRICT", async () => {
    const changedAttempts: number[] = [];
    await expect(executeGdpsSequentialCurrentSource({
      replayMode: "BEST_EFFORT",
      currentness: "CHANGED",
      executeAttempt: async (attempt) => {
        changedAttempts.push(attempt);
        return { value: `attempt-${attempt}`, sourceChangedDuringQuery: false };
      }
    })).resolves.toEqual({ status: "COMPLETED", attempts: ["attempt-1"] });
    expect(changedAttempts).toEqual([1]);

    const forbidden = vi.fn(async () => ({ value: "forbidden", sourceChangedDuringQuery: false }));
    await expect(executeGdpsSequentialCurrentSource({
      replayMode: "BEST_EFFORT", currentness: "CURRENT", executeAttempt: forbidden
    })).resolves.toEqual({ status: "CURRENT_CONFIRMED", attempts: [] });
    await expect(executeGdpsSequentialCurrentSource({
      replayMode: "BEST_EFFORT", currentness: "NOT_AVAILABLE", executeAttempt: forbidden
    })).resolves.toEqual({ status: "DATA_GAP", attempts: [] });
    await expect(executeGdpsSequentialCurrentSource({
      replayMode: "STRICT", currentness: "CHANGED", executeAttempt: forbidden
    })).resolves.toEqual({ status: "NOT_RUN_STRICT", attempts: [] });
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("retries SOURCE_CHANGED_DURING_QUERY once, then completes or becomes INDETERMINATE", async () => {
    const firstChanges = await executeGdpsSequentialCurrentSource({
      replayMode: "BEST_EFFORT",
      currentness: "CHANGED",
      executeAttempt: async (attempt) => ({
        value: `attempt-${attempt}`,
        sourceChangedDuringQuery: attempt === 1
      })
    });
    expect(firstChanges).toEqual({ status: "COMPLETED", attempts: ["attempt-1", "attempt-2"] });

    const alwaysChanges = await executeGdpsSequentialCurrentSource({
      replayMode: "BEST_EFFORT",
      currentness: "CHANGED",
      executeAttempt: async (attempt) => ({ value: `attempt-${attempt}`, sourceChangedDuringQuery: true })
    });
    expect(alwaysChanges).toEqual({
      status: "INDETERMINATE",
      attempts: ["attempt-1", "attempt-2"],
      reasonCode: "SOURCE_CHANGED",
      upstreamCondition: "SOURCE_CHANGED_DURING_QUERY"
    });
  });

  it("recognizes both Gateway error and GDPS INDETERMINATE source-change shapes", () => {
    const fixture = bestEffortSourceFixture();
    const submission = compileGdpsBestEffortCurrentSource(fixture.compileOptions).submission;
    const sourceNode = submission.plan.nodes.find((entry) => entry.operation.operationId === fixture.replay.sourceOperation)!;
    const baseNode = {
      nodeId: sourceNode.nodeId,
      operation: { operationId: fixture.replay.sourceOperation, operationVersion: "1.0" },
      status: "FAILED"
    };
    expect(isGdpsSourceChangedDuringQuery(submission, {
      nodes: [{
        ...baseNode,
        result: {
          operation: { operationId: fixture.replay.sourceOperation, operationVersion: "1.0" },
          status: "INDETERMINATE",
          output: { value: { code: "SOURCE_CHANGED_DURING_QUERY" } }
        }
      }]
    }, fixture.replay.sourceOperation)).toBe(true);
    expect(isGdpsSourceChangedDuringQuery(submission, {
      nodes: [{
        ...baseNode,
        error: { error: { code: "SOURCE_CHANGED_DURING_QUERY", stage: "DAG_EXECUTION" } }
      }]
    }, fixture.replay.sourceOperation)).toBe(true);
    expect(isGdpsSourceChangedDuringQuery(submission, {
      nodes: [{ ...baseNode, error: { error: { code: "PROVIDER_NOT_READY" } } }]
    }, fixture.replay.sourceOperation)).toBe(false);
  });

  it("persists source-change attempts with their real source operation identity", () => {
    const fixture = bestEffortSourceFixture();
    const submission = compileGdpsBestEffortCurrentSource(fixture.compileOptions).submission;
    const context = {
      groundingId: "grounding-currentness-replay"
    } as PipelineStageContext;
    const resultHash = digest("e");
    const record = gdpsSourceChangedAttemptRecord(context, {
      submission,
      status: "INDETERMINATE",
      resultHash,
      delegatedIdentityHash: digest("f"),
      startedAt: "2026-08-30T00:00:00.000Z",
      finishedAt: "2026-08-30T00:00:01.000Z",
      encryptedCheckpointEvidenceMaterial: {
        checkpointProtection: "AES_256_GCM_INTERNAL_ONLY",
        responseStatus: 200,
        response: {
          queryId: submission.plan.queryId,
          status: "INDETERMINATE",
          outputHash: resultHash,
          nodes: [{
            nodeId: submission.plan.nodes.find((entry) =>
              entry.operation.operationId === fixture.replay.sourceOperation)!.nodeId,
            operation: {
              operationId: fixture.replay.sourceOperation,
              operationVersion: fixture.replay.sourceOperationVersion
            },
            status: "FAILED",
            error: { error: { code: "SOURCE_CHANGED_DURING_QUERY", stage: "DAG_EXECUTION" } }
          }]
        }
      }
    }, fixture.replay, 1, {
      schemaVersion: "wsgs-gdps-best-effort-current-source/1.0",
      status: "INDETERMINATE"
    });
    expect(record).toMatchObject({
      groundingId: context.groundingId,
      executionKind: "WORLD_QUERY",
      operationId: fixture.replay.sourceOperation,
      operationVersion: fixture.replay.sourceOperationVersion,
      gatewayQueryId: submission.plan.queryId,
      requestHash: canonicalSha256(submission),
      resultHash,
      normalizedStatus: "INDETERMINATE",
      dataSnapshot: {
        gdpsBestEffortCurrentSource: {
          attempt: 1,
          attemptQueryId: submission.plan.queryId,
          upstreamCondition: "SOURCE_CHANGED_DURING_QUERY"
        }
      }
    });
  });

  it("rejects a contradictory CURRENT hash instead of silently advancing", () => {
    expect(() => normalizeGdpsCurrentnessWorldQuery(
      currentnessWorldQueryFixture("CURRENT", digest("d"))
    )).toThrow("GDPS_REPLAY_CURRENTNESS_CONTRADICTION");
  });

  it("fails closed before reading evidence for foreign scope or prior hash mismatch", async () => {
    const replay = currentnessReplay();
    const pointer = [{
      groundingId: replay.sourceGroundingId,
      resultHash: replay.sourceResultHash,
      selectedProductIds: [replay.selectedEvidenceProductId]
    }];
    const caller = {
      servicePrincipalId: "wsgs-service",
      actorId: "actor-1",
      dataScope: "scope-a",
      dataScopes: ["scope-a"],
      datasetScopes: ["dataset-a"],
      permissions: ["data:read"],
      authorizationContextHash: digest("e")
    };
    const foreignQuery = vi.fn(async () => ({ rows: [] }));
    await expect(loadPriorCurrentnessContexts({ query: foreignQuery } as never, caller, pointer))
      .rejects.toMatchObject({ code: "PRIOR_RESULT_NOT_FOUND_IN_SCOPE" });
    expect(foreignQuery).toHaveBeenCalledWith(expect.stringContaining("result.data_scope = $2"), [
      replay.sourceGroundingId, "scope-a", "actor-1"
    ]);

    const mismatchedQuery = vi.fn(async () => ({
      rows: [{
        result_hash: digest("f"),
        result_bytes: Buffer.from("{}", "utf8"),
        principal_id: caller.servicePrincipalId,
        dataset_scopes: caller.datasetScopes,
        authorization_context_hash: caller.authorizationContextHash
      }]
    }));
    await expect(loadPriorCurrentnessContexts({ query: mismatchedQuery } as never, caller, pointer))
      .rejects.toMatchObject({ code: "PRIOR_RESULT_NOT_FOUND_IN_SCOPE" });
    expect(mismatchedQuery).toHaveBeenCalledTimes(1);
  });

  it("loads the source submission only through the same-authority persisted request and query hashes", async () => {
    const fixture = bestEffortSourceFixture();
    const replay = fixture.replay;
    const caller = {
      servicePrincipalId: "wsgs-service",
      actorId: "actor-1",
      dataScope: "scope-a",
      dataScopes: ["scope-a"],
      datasetScopes: ["dataset-a"],
      permissions: ["data:read"],
      authorizationContextHash: digest("authorization")
    };
    const resultBytes = Buffer.from(JSON.stringify({
      groundingId: replay.sourceGroundingId,
      resultHash: replay.sourceResultHash,
      evidenceItems: [{
        evidenceProductId: replay.selectedEvidenceProductId,
        productKind: "CAPABILITY_RESULT",
        sourceOperation: replay.sourceOperation,
        safePayload: {
          productId: replay.productId,
          contentHash: replay.contentHash,
          historicalRasterPayload: { mustNeverBeReused: true }
        }
      }]
    }), "utf8");
    const nodeExecution = {
      execution_kind: "WORLD_QUERY_NODE",
      operation_id: replay.sourceOperation,
      operation_version: replay.sourceOperationVersion,
      gateway_query_id: replay.sourceGatewayQueryId,
      request_hash: digest("node-request"),
      data_snapshot: {
        gdpsSourceEvidence: {
          productId: replay.productId,
          contentHash: replay.contentHash,
          recipeId: replay.sourceRecipeId,
          recipeLockHash: replay.sourceRecipeLockHash,
          descriptorId: replay.descriptorId,
          descriptorHash: replay.descriptorHash,
          productType: replay.productType,
          productProfile: replay.productProfile,
          queryProfile: replay.queryProfile
        }
      }
    };
    const topExecution = {
      execution_kind: "WORLD_QUERY",
      operation_id: null,
      operation_version: null,
      gateway_query_id: replay.sourceGatewayQueryId,
      request_hash: canonicalSha256(fixture.persistedSource.submission),
      data_snapshot: null
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        result_hash: replay.sourceResultHash,
        result_bytes: resultBytes,
        principal_id: caller.servicePrincipalId,
        dataset_scopes: caller.datasetScopes,
        authorization_context_hash: caller.authorizationContextHash,
        gowm_operation_lock_hash: replay.sourceOperationLockHash
      }] })
      .mockResolvedValueOnce({ rows: [nodeExecution, topExecution] })
      .mockResolvedValueOnce({ rows: [{
        query_id: replay.sourceGatewayQueryId,
        gateway_query_id: replay.sourceGatewayQueryId,
        plan: fixture.persistedSource.submission,
        plan_hash: fixture.persistedSource.sourcePlanHash
      }] });
    const loaded = await loadPriorCurrentnessContexts({ query } as never, caller, [{
      groundingId: replay.sourceGroundingId,
      resultHash: replay.sourceResultHash,
      selectedProductIds: [replay.selectedEvidenceProductId]
    }]);
    expect(loaded.gdpsCurrentnessReplays).toEqual([{ ...replay, replayMode: "STRICT" }]);
    expect(loaded.gdpsPersistedSourceQueries).toEqual([fixture.persistedSource]);
    expect(JSON.stringify(loaded)).not.toContain("mustNeverBeReused");
    expect(query.mock.calls[2]?.[0]).toContain("query_id = $3");
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

  it("passes only canonical business references to the production resolver", () => {
    const span = (start: number, end: number) => ({ encoding: "UTF16_CODE_UNIT" as const, start, end });
    expect(productionReferenceMentions([
      {
        mentionId: "vehicle", surfaceText: "2号车", span: span(0, 3), expectedKinds: ["vehicle"],
        semanticRole: "location", extractionSources: ["DOMAIN_MODEL"]
      },
      {
        mentionId: "where", surfaceText: "哪里", span: span(3, 5), expectedKinds: ["location"],
        semanticRole: "question", extractionSources: ["DOMAIN_MODEL"]
      },
      {
        mentionId: "punctuation", surfaceText: "？", span: span(5, 6), expectedKinds: ["punctuation"],
        extractionSources: ["DOMAIN_MODEL"]
      },
      {
        mentionId: "road", surfaceText: "滨河路", span: span(0, 3), expectedKinds: ["road"],
        extractionSources: ["DOMAIN_MODEL"]
      },
      {
        mentionId: "known", surfaceText: "A区", span: span(0, 2), expectedKinds: ["area"],
        extractionSources: ["KNOWN_REFERENCE"]
      }
    ])).toEqual([
      expect.objectContaining({ mentionId: "vehicle", expectedKinds: ["WORLD_OBJECT"] }),
      expect.objectContaining({ mentionId: "road", expectedKinds: ["LAYER_FEATURE"] }),
      expect.objectContaining({ mentionId: "known", expectedKinds: ["LAYER_FEATURE"] })
    ]);
  });

  it("fails closed when a requested reference mention is absent from the upstream result", () => {
    const mention = {
      mentionId: "missing", surfaceText: "2号车",
      span: { encoding: "UTF16_CODE_UNIT" as const, start: 0, end: 3 },
      expectedKinds: ["WORLD_OBJECT"], extractionSources: ["DOMAIN_MODEL" as const]
    };
    const result = normalizeReferenceResolution({
      schemaVersion: "1.0", worldVersion: 42, resolverVersion: "resolver-1", resolutions: []
    }, [mention]);
    expect(result.mentions).toEqual([expect.objectContaining({ mentionId: "missing", status: "UNRESOLVED" })]);
    expect(result.unresolvedMentions).toEqual([{
      mentionId: "missing", surfaceText: "2号车", reason: "UPSTREAM_RESULT_MISSING"
    }]);
  });

  it("maps the unified locked validation result into the frozen WSGS status", () => {
    const key = { namespace: "gowm", kind: "WORLD_OBJECT", id: `wrf_${"a".repeat(32)}`, version: "v1" };
    expect(normalizeValidation({
      schemaVersion: "1.0",
      results: [{
        schemaVersion: "1.0", referenceKey: key, existence: "AVAILABLE", freshness: "CURRENT",
        snapshot: "CURRENT", usable: "YES", reasons: []
      }, {
        schemaVersion: "1.0", referenceKey: key, existence: "AVAILABLE", freshness: "CURRENT",
        snapshot: "NOT_APPLICABLE", usable: "YES", reasons: []
      }, {
        schemaVersion: "1.0", referenceKey: key, existence: "AVAILABLE", freshness: "CURRENT",
        snapshot: "UNKNOWN", usable: "REVALIDATE", reasons: ["Snapshot currentness is unknown"]
      }]
    })).toEqual([
      { referenceKey: key, status: "VALID", revalidationRequired: false, warnings: [] },
      { referenceKey: key, status: "VALID", revalidationRequired: false, warnings: [] },
      { referenceKey: key, status: "STALE", revalidationRequired: true, warnings: ["Snapshot currentness is unknown"] }
    ]);
  });

  it("does not re-resolve an exact known reference selected by a continuation", () => {
    const known = {
      mentionId: "known", surfaceText: "滨河路",
      span: { encoding: "UTF16_CODE_UNIT" as const, start: 0, end: 3 },
      expectedKinds: ["LAYER_FEATURE"], extractionSources: ["KNOWN_REFERENCE" as const]
    };
    const model = {
      mentionId: "model", surfaceText: "设备",
      span: { encoding: "UTF16_CODE_UNIT" as const, start: 7, end: 9 },
      expectedKinds: ["WORLD_OBJECT"], extractionSources: ["DOMAIN_MODEL" as const]
    };
    const deterministic: DeterministicParseResult = {
      parserVersion: "deterministic-parser/1.0",
      mentions: [{
        mentionId: "known", surfaceText: "滨河路",
        span: known.span, expectedKinds: ["LAYER_FEATURE"], extractionSource: "KNOWN_REFERENCE", priority: 400,
        candidate: {
          kind: "KNOWN_REFERENCE", value: { alias: "滨河路" }, approximate: false,
          requiresUpstreamValidation: true,
          referenceKey: { namespace: "gowm", kind: "LAYER_FEATURE", id: `wrf_${"d".repeat(32)}`, version: "1.0.0" }
        }
      }],
      ambiguities: [], priorGroundings: [], warnings: []
    };
    expect(referenceMentionsRequiringResolution([known, model], deterministic)).toEqual([
      expect.objectContaining({ mentionId: "model", expectedKinds: ["WORLD_OBJECT"] })
    ]);
  });

  it("publishes a bounded northbound lease only for a currently usable reference", () => {
    const key = { namespace: "gowm" as const, kind: "WORLD_OBJECT", id: `wrf_${"b".repeat(32)}`, version: "7" };
    const product = {
      productId: "reference-1", productKind: "RESOLVED_REFERENCE" as const, referenceKey: key,
      referenceType: "VEHICLE", displayName: "2号车", matchedBy: "EXACT", matchScore: 1,
      sourceOperation: "reference.resolve" as const, sourceWorldVersion: 7,
      validUntil: "2026-08-29T00:00:00.000Z", revalidationRequired: true,
      safeSummary: { source: "resolver" }
    };
    const valid = applyReferenceValidation(product, {
      referenceKey: key, status: "VALID", revalidationRequired: false, warnings: []
    }, "2026-08-29T01:00:00.000Z", 60_000);
    expect(valid).toMatchObject({
      sourceOperation: "VALIDATE_REFERENCES", revalidationRequired: false,
      validUntil: "2026-08-29T01:01:00.000Z",
      safeSummary: {
        validationStatus: "VALID", validationSourceOperation: "reference.validate",
        validationEvaluatedAt: "2026-08-29T01:00:00.000Z",
        validitySemantics: "GOWM_REFERENCE_VALIDATE_BOUNDED_LEASE"
      }
    });

    const stale = applyReferenceValidation(product, {
      referenceKey: key, status: "STALE", revalidationRequired: true, warnings: ["stale"]
    }, "2026-08-29T01:00:00.000Z", 60_000);
    expect(stale).toMatchObject({ sourceOperation: "VALIDATE_REFERENCES", revalidationRequired: true });
    expect(stale).not.toHaveProperty("validUntil");
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

  it("keeps KnownWorldReferences on the EXECUTE path when resolver output is empty", () => {
    const key = { namespace: "gowm" as const, kind: "WORLD_OBJECT", id: `wrf_${"c".repeat(32)}`, version: "7" };
    const merged = mergeKnownReferenceProducts(normalizeReferenceResolution(null, []), [{
      alias: "2号车",
      referenceKey: key,
      referenceType: "VEHICLE",
      sourceMessageId: "message-1",
      sourceGroundingId: "grounding-1"
    }]);
    expect(merged.referenceProducts).toHaveLength(1);
    expect(merged.referenceProducts[0]).toMatchObject({
      referenceKey: key,
      displayName: "2号车",
      matchedBy: "EXACT_REFERENCE_KEY",
      revalidationRequired: true,
      safeSummary: { source: "contextCapsule" }
    });
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

  it("reconstructs a linked nearby node input from the submitted radius and current position coordinates", () => {
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
            schemaUri: "urn:test:position-coordinates",
            schemaHash: digest("7"),
            valueKind: "ANY",
            unitSemantics: "ANGULAR_DEGREES"
          },
          nodeId: "Node_1",
          outputPort: "positionCoordinates",
          path: "/facts/0/position/coordinates",
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
    const positionCoordinates = [116.4, 39.9];
    const hashes = computeWorldQueryNodeRequestHashes(submission, {
      nodes: [{
        nodeId: "Node_1",
        status: "COMPLETED",
        result: { output: { value: { facts: [{ position: { type: "Point", coordinates: positionCoordinates } }] } } }
      }, { nodeId: "Node_2", status: "COMPLETED" }]
    }, [{
      operationId: "reference.resolve",
      operationVersion: "1.0",
      ports: {
        inputs: [{ name: "request" }],
        outputs: [{ name: "positionCoordinates", path: "/facts/0/position/coordinates" }]
      }
    }, {
      operationId: "spatial.find-nearby",
      operationVersion: "1.0",
      ports: { inputs: [{ name: "request" }], outputs: [] }
    }] as never);
    expect(hashes["Node_2"]).toBe(canonicalSha256({ location: positionCoordinates, radiusM: 1_000 }));
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
