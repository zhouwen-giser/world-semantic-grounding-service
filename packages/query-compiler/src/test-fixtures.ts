import { createHash } from "node:crypto";
import type {
  CapabilityDescriptor,
  CapabilityPort,
  CapabilitySemanticEntry,
  CapabilitySemanticProfile,
  CompileInput,
  OperationAvailability,
  OperationLock,
  PortRequirement,
  QuerySemanticPattern
} from "./types.js";
import { canonicalSemanticProfileHash } from "./matcher.js";
import { queryTemplateRules } from "./recipes.js";

export const observedAt = "2026-08-27T00:00:00.000Z";

export function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function operationKey(value: { operationId: string; operationVersion: string }): string {
  return `${value.operationId}@${value.operationVersion}`;
}

function port(requirement: PortRequirement, operation: string, direction: string): CapabilityPort {
  return {
    name: requirement.name,
    schemaUri: `urn:test:${operation}:${direction}:${requirement.name}`,
    schemaHash: requirement.schemaHash ??
      digest(`${operation}:${direction}:${requirement.name}`),
    valueKind: requirement.valueKind,
    unitSemantics: requirement.unitSemantics
  };
}

function costClass(operationId: string): "LOW" | "MEDIUM" | "HIGH" {
  if (operationId === "reference.resolve" || operationId.includes("validate")) return "LOW";
  if (operationId.startsWith("spatial.")) return "HIGH";
  return "MEDIUM";
}

function descriptorMaturity(operationId: string): "STABLE" | "PREVIEW" {
  return (
    operationId.startsWith("h3.") ||
    operationId === "world.get-event-timeline" ||
    operationId === "spatial.find-containing-area" ||
    operationId === "correlation.resolve" ||
    operationId === "predicate.evaluate" ||
    operationId.startsWith("operational-task.") ||
    operationId === "history.get-trajectory" ||
    ["landcover.", "hydrology.", "obstacle.", "traversability.", "terrain.", "elevation.", "geo-raster.", "geo-vector."]
      .some((prefix) => operationId.startsWith(prefix))
  ) ? "PREVIEW" : "STABLE";
}

function profileFor(
  operationId: string,
  requirement: (typeof queryTemplateRules)[number]["steps"][number]["requirement"]
): CapabilitySemanticProfile {
  return {
    profileVersion: "1.0",
    domain: requirement.domain,
    relationSemantics: [...requirement.relationSemantics],
    acceptedReferenceKinds: [...requirement.acceptedReferenceKinds],
    producedReferenceKinds: [...requirement.producedReferenceKinds],
    spatialSemantics: operationId === "h3.geometry.cover"
      ? "CANDIDATE"
      : requirement.spatialSemantics,
    timeSemantics: requirement.timeSemantics,
    resultNature: requirement.resultNature,
    negativeEvidencePolicy: "NO_DATA_IS_UNKNOWN",
    freshnessSemantics: "SNAPSHOT_CURRENTNESS",
    ...(operationId === "h3.geometry.cover"
      ? { exactVerification: { operationId: "spatial.find-intersections", operationVersion: "1.0" } }
      : {})
  };
}

function makeOperation(
  operationId: string,
  operationVersion: string,
  requirement: (typeof queryTemplateRules)[number]["steps"][number]["requirement"]
): {
  descriptor: CapabilityDescriptor;
  semanticEntry: CapabilitySemanticEntry;
  lock: OperationLock;
  availability: OperationAvailability;
} {
  const key = `${operationId}@${operationVersion}`;
  const inputSchemaHash = digest(`${key}:input`);
  const outputSchemaHash = digest(`${key}:output`);
  const profile = profileFor(operationId, requirement);
  const semanticProfileHash = canonicalSemanticProfileHash(profile);
  const maturity = descriptorMaturity(operationId);
  const worldIndependent = operationId.startsWith("h3.");
  const inputs = requirement.inputPorts.map((entry) => port(entry, key, "input"));
  const outputs = requirement.outputPorts.map((entry) => port(entry, key, "output"));
  if (operationId === "h3.geometry.cover") {
    outputs.push({
      name: "cells",
      path: "/cells",
      schemaUri: `urn:test:${key}:output:cells`,
      schemaHash: digest(`${key}:output:cells`),
      valueKind: "H3_CELL_SET",
      unitSemantics: "DISCRETE"
    });
  }
  const descriptor: CapabilityDescriptor = {
    operationId,
    operationVersion,
    semanticProfile: profile,
    semanticRole: "FOUNDATION_DATA_QUERY",
    dataBinding: worldIndependent ? "WORLD_INDEPENDENT" : "WORLD_SNAPSHOT_BOUND",
    resultSemantics: profile.resultNature === "VALIDATION" ? "VALIDATION" : "DATA_QUERY",
    executionBindings: ["SYNC_HTTP"],
    criticalPathPolicy: "REMOTE_ONLY",
    maturity,
    inputSchemaUri: `urn:test:${key}:input`,
    inputSchemaHash,
    outputSchemaUri: `urn:test:${key}:output`,
    outputSchemaHash,
    scopePolicy: "DATA_SCOPE_REQUIRED",
    execution: {
      mode: "SYNC",
      defaultTimeoutMs: 1_000,
      maximumTimeoutMs: 60_000,
      costClass: costClass(operationId)
    },
    limits: {
      maximumInputBytes: 1_000_000,
      maximumOutputBytes: 10_000_000,
      maximumRows: 10_000,
      maximumCandidates: 10_000
    },
    snapshotPolicy: {
      dataSnapshot: worldIndependent ? "NONE" : "REQUIRED",
      computeSnapshot: "REQUIRED"
    },
    ports: { inputs, outputs }
  };
  return {
    descriptor,
    semanticEntry: {
      operationId,
      operationVersion,
      semanticProfile: profile,
      semanticProfileHash
    },
    lock: {
      operationId,
      operationVersion,
      maturity,
      inputSchemaHash,
      outputSchemaHash,
      semanticProfileHash,
      snapshotSupport: worldIndependent ? "NONE" : "CONSISTENT_AT_START",
      requiredPermissions: ["data:read"]
    },
    availability: {
      operationId,
      operationVersion,
      maturity,
      availability: "AVAILABLE",
      reasonCodes: [],
      checkedAt: observedAt,
      validUntil: "2026-08-27T01:00:00.000Z",
      contractCatalogRevision: digest("catalog"),
      bindingRevision: digest("binding")
    }
  };
}

export interface CompilerCatalog {
  capabilities: CapabilityDescriptor[];
  semanticProfiles: CapabilitySemanticEntry[];
  operationLocks: OperationLock[];
  availability: OperationAvailability[];
}

export function compilerCatalog(): CompilerCatalog {
  const operations = new Map<string, ReturnType<typeof makeOperation>>();
  for (const rule of queryTemplateRules) {
    for (const step of rule.steps) {
      const key = step.requirement.allowedOperationKeys?.[0];
      if (!key) continue;
      const splitAt = key.lastIndexOf("@");
      const operationId = key.slice(0, splitAt);
      const operationVersion = key.slice(splitAt + 1);
      const existing = operations.get(key);
      if (existing) {
        for (const requirementPort of step.requirement.outputPorts) {
          if (existing.descriptor.ports.outputs.some((entry) => entry.name === requirementPort.name)) continue;
          existing.descriptor.ports.outputs.push(port(requirementPort, key, "output"));
        }
        continue;
      }
      operations.set(key, makeOperation(operationId, operationVersion, step.requirement));
    }
  }
  return {
    capabilities: [...operations.values()].map((entry) => entry.descriptor),
    semanticProfiles: [...operations.values()].map((entry) => entry.semanticEntry),
    operationLocks: [...operations.values()].map((entry) => entry.lock),
    availability: [...operations.values()].map((entry) => entry.availability)
  };
}

export function compileInput(pattern: QuerySemanticPattern): CompileInput {
  const catalog = compilerCatalog();
  return {
    requestId: "request-1",
    idempotencyKey: "idem-1",
    pattern,
    requiredForProduct: "WORLD_EVIDENCE",
    operationInput: {
      schemaVersion: "1.0",
      mentions: [{ mentionId: "m1", surfaceText: "滨河路" }],
      context: { anchorReferenceKeys: [] },
      limitPerMention: 5
    },
    parameterValues: { distanceM: 1_000, distanceMetres: 1_000 },
    parameterSchemaHash: digest("world-query-parameters"),
    ...catalog,
    maturityPolicy: { allowPreview: false },
    degradedPolicy: "REJECT",
    snapshotPolicy: { mode: "LATEST_AT_START", allowDowngrade: false },
    observedAt,
    budgets: {
      maximumNodes: 16,
      maximumDepth: 16,
      maximumRows: 1_000,
      maximumCandidates: 1_000,
      maximumOutputBytes: 1_000_000,
      maximumExecutionMs: 30_000
    }
  };
}

export function historicalCompileInput(pattern: "HISTORICAL_EXECUTION_INTERVAL" | "HISTORICAL_TRAJECTORY"): CompileInput {
  const input = compileInput(pattern);
  input.maturityPolicy.allowPreview = true;
  input.operationInput = {
    taskReferenceKey: { namespace: "gowm", kind: "OPERATIONAL_TASK", id: "task-a", version: "3" },
    selection: { kind: "LATEST" },
    phaseScope: "EXECUTION_ENVELOPE"
  };
  input.parameterValues = {
    subjectReferenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: "vehicle-2", version: "7" },
    phaseScope: "EXECUTION_ENVELOPE",
    sourceSelection: { mode: "ONLY_CANDIDATE" },
    sourceSelectionProfileReferenceKey: {
      namespace: "gowm", kind: "HISTORY_METHOD_PROFILE", id: "default-history", version: "1"
    },
    maximumInlinePoints: 128
  };
  return input;
}

export function authorizeGdps(input: CompileInput, values: {
  descriptorId?: string;
  descriptorHash?: `sha256:${string}`;
  productType?: string;
  productProfile?: string;
} = {}): CompileInput {
  const rule = queryTemplateRules.find((entry) => entry.pattern === input.pattern);
  if (!rule?.previewAuthorizationRequired) throw new Error(`NOT_GDPS_RECIPE:${input.pattern}`);
  const operationKeys = rule.steps.flatMap((step) => step.requirement.allowedOperationKeys ?? [])
    .filter((key) => !key.startsWith("reference.") && !key.startsWith("world."));
  const allowedOperations = operationKeys.map((key) => {
    const separator = key.lastIndexOf("@");
    const operationId = key.slice(0, separator);
    const operationVersion = key.slice(separator + 1);
    const lock = input.operationLocks.find((entry) => entry.operationId === operationId && entry.operationVersion === operationVersion)!;
    return {
      operationId, operationVersion,
      inputSchemaHash: lock.inputSchemaHash,
      outputSchemaHash: lock.outputSchemaHash,
      semanticProfileHash: lock.semanticProfileHash
    };
  });
  const descriptorId = values.descriptorId ?? "LEGACY/LOCKED";
  const descriptorHash = values.descriptorHash ?? digest(descriptorId);
  input.gdpsRecipeAuthorization = {
    recipeId: `recipe-${input.pattern.toLowerCase().replaceAll("_", "-")}`,
    semanticPattern: input.pattern,
    recipeLockHash: digest(`recipe:${input.pattern}`),
    descriptorId,
    descriptorHash,
    previewAuthorizationRequired: true,
    allowedOperations
  };
  input.trustedGdpsRecipeLockHash = input.gdpsRecipeAuthorization.recipeLockHash;
  input.parameterValues = {
    ...input.parameterValues,
    descriptorId,
    descriptorHash,
    ...(values.productType ? { productType: values.productType } : {}),
    ...(values.productProfile ? { productProfile: values.productProfile } : {})
  };
  return input;
}

export function operationFrom(catalog: CompilerCatalog, key: string): {
  descriptor: CapabilityDescriptor;
  semanticEntry: CapabilitySemanticEntry;
  lock: OperationLock;
  availability: OperationAvailability;
} {
  const descriptor = catalog.capabilities.find((entry) => operationKey(entry) === key)!;
  const semanticEntry = catalog.semanticProfiles.find((entry) => operationKey(entry) === key)!;
  const lock = catalog.operationLocks.find((entry) => operationKey(entry) === key)!;
  const availability = catalog.availability.find((entry) => operationKey(entry) === key)!;
  return { descriptor, semanticEntry, lock, availability };
}
