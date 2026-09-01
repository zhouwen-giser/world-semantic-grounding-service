export type Sha256 = string;

export const gdpsV032RequirementKinds = [
  "POINT_VALUE",
  "POINT_CLASSIFICATION",
  "PROFILE",
  "CLASS_AREAS",
  "VALUE_RANGE_AREAS",
  "FEATURES_IN_AREA",
  "FEATURES_NEARBY",
  "INTERSECTIONS"
] as const;

export type GdpsV032RequirementKind = (typeof gdpsV032RequirementKinds)[number];

export interface GdpsV032Requirement {
  schemaVersion: "wsgs-gdps-requirement/1.0";
  requirementId: string;
  kind: GdpsV032RequirementKind;
  productType: string;
  productProfile: string;
  platformProfile?: string;
  geometry: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  timeIntent: "CURRENT" | "HISTORICAL";
}

export interface TrustedExplicitProductSelection {
  productId: string;
  source: "USER_EXPLICIT" | "TRUSTED_STRUCTURED_REQUEST" | "REVALIDATED_PRIOR_REFERENCE";
  descriptorHash: Sha256;
}

export interface GdpsV032TrustedContext {
  servicePrincipalId: string;
  dataScope: string;
  maximumGeometryBytes: number;
  explicitProductSelection?: TrustedExplicitProductSelection;
}

export interface GdpsV032OperationState {
  operationId: string;
  operationVersion: string;
  maturity: "STABLE" | "PREVIEW";
  inputSchemaHash: Sha256;
  outputSchemaHash: Sha256;
  semanticProfileHash: Sha256;
}

export interface GdpsV032CatalogFamily {
  familyId: string;
  operationId: string;
  operationVersion: string;
  inputSchemaHash: Sha256;
  outputSchemaHash: Sha256;
  semanticProfileHash: Sha256;
  allowedMaturity: ReadonlyArray<"STABLE" | "PREVIEW">;
}

export interface GdpsV032CatalogBinding extends GdpsV032CatalogFamily {
  bindingId: string;
  requirementKind: GdpsV032RequirementKind;
  requirementVersion: "1.0";
  productType: string;
  productProfile: string;
  descriptorId: string;
  descriptorHash: Sha256;
  queryProfile: string;
  platformProfilePolicy: "OPTIONAL" | "REQUIRED";
  selectionPolicy: {
    defaultProductId: null;
    explicitProductId: "TRUSTED_EXPLICIT_SELECTION_ONLY";
    requiresFullCoverage: true;
    scopePolicy: "CURRENT_SCOPE_AUTHORIZED_DESCRIPTOR_MATCH";
  };
  timeSemantics: "CURRENT";
  noDataSemantics: "EXPLICIT_GAP";
  evidenceMapping: {
    dataSnapshot: "REQUIRED";
    executionReceipt: "REQUIRED";
    contentHash: "REQUIRED";
    descriptorHash: "REQUIRED";
    temporalApplicability: "CURRENT_AT_QUERY_START";
  };
}

export interface GdpsV032BindingCatalog {
  schemaVersion: "wsgs-gdps-binding-catalog/1.0";
  authority: "WSGS";
  policy: {
    defaultProductIdBinding: "FORBIDDEN";
    explicitUserProductSelection: "ALLOWED";
    requiresExactSchemaHashes: true;
    requiresExactSemanticHash: true;
    requiresExactDescriptorHash: true;
    historicalFallback: "FORBIDDEN";
  };
  operationFamilies: GdpsV032CatalogFamily[];
  bindings: GdpsV032CatalogBinding[];
}

export type GdpsV032CompilationGapReason =
  | "INVALID_REQUIREMENT"
  | "HISTORICAL_INTENT_UNSUPPORTED"
  | "BINDING_NOT_FOUND"
  | "BINDING_AMBIGUOUS"
  | "CATALOG_POLICY_INVALID"
  | "CATALOG_LOCK_DRIFT"
  | "MATURITY_NOT_ALLOWED"
  | "OPERATION_LOCK_DRIFT"
  | "PLATFORM_PROFILE_REQUIRED"
  | "GEOMETRY_INVALID"
  | "GEOMETRY_BUDGET_EXCEEDED"
  | "PARAMETER_POLICY_VIOLATION"
  | "EXPLICIT_PRODUCT_SELECTION_INVALID";

export interface GdpsV032CompiledOperationRequest {
  schemaVersion: "wsgs-gdps-compiled-operation/1.0";
  requirementId: string;
  operation: {
    operationId: string;
    operationVersion: string;
  };
  locks: {
    inputSchemaHash: Sha256;
    outputSchemaHash: Sha256;
    semanticProfileHash: Sha256;
    descriptorHash: Sha256;
  };
  binding: {
    bindingId: string;
    familyId: string;
    descriptorId: string;
    productType: string;
    productProfile: string;
    queryProfile: string;
  };
  authorization: {
    servicePrincipalId: string;
    dataScope: string;
    source: "TRUSTED_IDENTITY";
  };
  snapshotPolicy: {
    mode: "LATEST_AT_START";
    allowHistoricalFallback: false;
  };
  input: Record<string, unknown>;
}

export type GdpsV032CompileResult =
  | { status: "COMPILED"; request: GdpsV032CompiledOperationRequest }
  | { status: "GAP"; reason: GdpsV032CompilationGapReason; details?: Record<string, unknown> };

const requirementKeys = new Set([
  "schemaVersion", "requirementId", "kind", "productType", "productProfile",
  "platformProfile", "geometry", "parameters", "timeIntent"
]);
const allowedParameterKeys = new Set([
  "classCodes", "ranges", "distanceMetres", "limit", "minimumAreaSquareMetres",
  "propertyFilters", "sampleCount"
]);
const identifier = /^[A-Z][A-Z0-9_]{0,63}$/u;
const principalIdentifier = /^[a-z][a-z0-9._-]{2,127}$/u;
const productIdentifier = /^[a-z][a-z0-9-]{2,127}$/u;
const expectedGeometry: Record<GdpsV032RequirementKind, readonly string[]> = {
  POINT_VALUE: ["Point"],
  POINT_CLASSIFICATION: ["Point"],
  PROFILE: ["LineString"],
  CLASS_AREAS: ["Polygon", "MultiPolygon"],
  VALUE_RANGE_AREAS: ["Polygon", "MultiPolygon"],
  FEATURES_IN_AREA: ["Polygon", "MultiPolygon"],
  FEATURES_NEARBY: ["Point"],
  INTERSECTIONS: ["Polygon", "MultiPolygon", "LineString", "MultiLineString"]
};
const geometryInputName: Record<GdpsV032RequirementKind, "point" | "line" | "selector"> = {
  POINT_VALUE: "point",
  POINT_CLASSIFICATION: "point",
  PROFILE: "line",
  CLASS_AREAS: "selector",
  VALUE_RANGE_AREAS: "selector",
  FEATURES_IN_AREA: "selector",
  FEATURES_NEARBY: "point",
  INTERSECTIONS: "selector"
};

function gap(reason: GdpsV032CompilationGapReason, details?: Record<string, unknown>): GdpsV032CompileResult {
  return details === undefined ? { status: "GAP", reason } : { status: "GAP", reason, details };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameOperationLock(binding: GdpsV032CatalogBinding, state: GdpsV032OperationState): boolean {
  return binding.operationId === state.operationId &&
    binding.operationVersion === state.operationVersion &&
    binding.inputSchemaHash === state.inputSchemaHash &&
    binding.outputSchemaHash === state.outputSchemaHash &&
    binding.semanticProfileHash === state.semanticProfileHash;
}

function validateCatalogBinding(
  catalog: GdpsV032BindingCatalog,
  binding: GdpsV032CatalogBinding
): GdpsV032CompilationGapReason | undefined {
  const family = catalog.operationFamilies.find((entry) => entry.familyId === binding.familyId);
  if (family === undefined) return "CATALOG_LOCK_DRIFT";
  for (const key of [
    "operationId", "operationVersion", "inputSchemaHash", "outputSchemaHash", "semanticProfileHash"
  ] as const) {
    if (binding[key] !== family[key]) return "CATALOG_LOCK_DRIFT";
  }
  if (JSON.stringify(binding.allowedMaturity) !== JSON.stringify(family.allowedMaturity) ||
      binding.selectionPolicy.defaultProductId !== null ||
      binding.selectionPolicy.explicitProductId !== "TRUSTED_EXPLICIT_SELECTION_ONLY" ||
      binding.timeSemantics !== "CURRENT") {
    return "CATALOG_LOCK_DRIFT";
  }
  return undefined;
}

export function compileGdpsV032Requirement(input: {
  requirement: GdpsV032Requirement;
  catalog: GdpsV032BindingCatalog;
  trustedContext: GdpsV032TrustedContext;
  operationState: GdpsV032OperationState;
}): GdpsV032CompileResult {
  const { requirement, catalog, trustedContext, operationState } = input;
  if (!isObject(requirement) || Object.keys(requirement).some((key) => !requirementKeys.has(key)) ||
      requirement.schemaVersion !== "wsgs-gdps-requirement/1.0" ||
      !principalIdentifier.test(requirement.requirementId) ||
      !gdpsV032RequirementKinds.includes(requirement.kind) ||
      !identifier.test(requirement.productType) ||
      !identifier.test(requirement.productProfile)) {
    return gap("INVALID_REQUIREMENT");
  }
  if (requirement.timeIntent !== "CURRENT") return gap("HISTORICAL_INTENT_UNSUPPORTED");
  if (catalog.authority !== "WSGS" ||
      catalog.policy.defaultProductIdBinding !== "FORBIDDEN" ||
      catalog.policy.explicitUserProductSelection !== "ALLOWED" ||
      catalog.policy.historicalFallback !== "FORBIDDEN" ||
      !catalog.policy.requiresExactSchemaHashes ||
      !catalog.policy.requiresExactSemanticHash ||
      !catalog.policy.requiresExactDescriptorHash) {
    return gap("CATALOG_POLICY_INVALID");
  }
  const matches = catalog.bindings.filter((binding) =>
    binding.requirementKind === requirement.kind &&
    binding.productType === requirement.productType &&
    binding.productProfile === requirement.productProfile);
  if (matches.length === 0) return gap("BINDING_NOT_FOUND");
  if (matches.length !== 1) return gap("BINDING_AMBIGUOUS", { bindingCount: matches.length });
  const binding = matches[0]!;
  const catalogError = validateCatalogBinding(catalog, binding);
  if (catalogError !== undefined) return gap(catalogError);
  if (!binding.allowedMaturity.includes(operationState.maturity)) {
    return gap("MATURITY_NOT_ALLOWED", { observedMaturity: operationState.maturity });
  }
  if (!sameOperationLock(binding, operationState)) return gap("OPERATION_LOCK_DRIFT");
  if (binding.platformProfilePolicy === "REQUIRED" &&
      (requirement.platformProfile === undefined || !identifier.test(requirement.platformProfile))) {
    return gap("PLATFORM_PROFILE_REQUIRED");
  }
  if (!isObject(requirement.geometry) ||
      !expectedGeometry[requirement.kind].includes(String(requirement.geometry["type"]))) {
    return gap("GEOMETRY_INVALID");
  }
  const geometryBytes = Buffer.byteLength(JSON.stringify(requirement.geometry), "utf8");
  if (!Number.isSafeInteger(trustedContext.maximumGeometryBytes) ||
      trustedContext.maximumGeometryBytes < 1 ||
      geometryBytes > trustedContext.maximumGeometryBytes) {
    return gap("GEOMETRY_BUDGET_EXCEEDED", { geometryBytes });
  }
  const parameters = requirement.parameters ?? {};
  if (!isObject(parameters) || Object.keys(parameters).some((key) => !allowedParameterKeys.has(key))) {
    return gap("PARAMETER_POLICY_VIOLATION");
  }
  if (!principalIdentifier.test(trustedContext.servicePrincipalId) ||
      !principalIdentifier.test(trustedContext.dataScope)) {
    return gap("INVALID_REQUIREMENT");
  }
  const explicit = trustedContext.explicitProductSelection;
  if (explicit !== undefined &&
      (!productIdentifier.test(explicit.productId) || explicit.descriptorHash !== binding.descriptorHash)) {
    return gap("EXPLICIT_PRODUCT_SELECTION_INVALID");
  }
  const operationInput: Record<string, unknown> = {
    productType: binding.productType,
    productProfile: binding.productProfile,
    ...(requirement.platformProfile === undefined ? {} : { platformProfile: requirement.platformProfile }),
    [geometryInputName[requirement.kind]]: requirement.geometry,
    ...parameters,
    ...(explicit === undefined ? {} : { productId: explicit.productId })
  };
  return {
    status: "COMPILED",
    request: {
      schemaVersion: "wsgs-gdps-compiled-operation/1.0",
      requirementId: requirement.requirementId,
      operation: {
        operationId: binding.operationId,
        operationVersion: binding.operationVersion
      },
      locks: {
        inputSchemaHash: binding.inputSchemaHash,
        outputSchemaHash: binding.outputSchemaHash,
        semanticProfileHash: binding.semanticProfileHash,
        descriptorHash: binding.descriptorHash
      },
      binding: {
        bindingId: binding.bindingId,
        familyId: binding.familyId,
        descriptorId: binding.descriptorId,
        productType: binding.productType,
        productProfile: binding.productProfile,
        queryProfile: binding.queryProfile
      },
      authorization: {
        servicePrincipalId: trustedContext.servicePrincipalId,
        dataScope: trustedContext.dataScope,
        source: "TRUSTED_IDENTITY"
      },
      snapshotPolicy: {
        mode: "LATEST_AT_START",
        allowHistoricalFallback: false
      },
      input: operationInput
    }
  };
}
