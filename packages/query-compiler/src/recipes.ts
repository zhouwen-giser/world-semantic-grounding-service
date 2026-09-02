import type {
  PortRequirement,
  QuerySemanticPattern,
  SchemaPort,
  SemanticCapabilityRequirement,
  SnapshotMode,
  WorldQueryNode
} from "./types.js";

type RequirementContract = Omit<
  SemanticCapabilityRequirement,
  "requirementId" | "semanticCapability" | "requiredForProduct" | "snapshotMode"
>;

export interface QueryTemplateLink {
  sourceStepId: string;
  outputPort: string;
  sourcePath?: string;
  inputName: string;
  targetPath: string;
}

export interface QueryTemplateOutput {
  name: string;
  sourceStepId: string;
  outputPort: string;
  sourcePath?: string;
}

export interface QueryTemplateRequestBinding {
  inputName: string;
  path: string;
  targetPath: string;
  port?: SchemaPort;
  optional?: boolean;
  /** Emit a source-validated parameter as an immutable node literal. */
  literalFromParameter?: boolean;
}

export interface QueryTemplateLiteralBinding {
  inputName: string;
  value: unknown;
  targetPath: string;
  port: SchemaPort;
}

export interface QueryTemplateStep {
  stepId: string;
  requirement: RequirementContract;
  costWeight: number;
  failurePolicy: WorldQueryNode["failurePolicy"];
  links: readonly QueryTemplateLink[];
  requestBindings?: readonly QueryTemplateRequestBinding[];
  literalBindings?: readonly QueryTemplateLiteralBinding[];
}

export interface QueryTemplateRule {
  templateId: string;
  pattern: Exclude<QuerySemanticPattern, "TERRAIN_VISIBILITY">;
  maturity: "STABLE" | "PREVIEW";
  allowDegraded: boolean;
  previewAuthorizationRequired?: boolean;
  authorizationRecipeId?: string;
  descriptorAuthorizationRequired?: boolean;
  requiresTrustedOperationInput?: true;
  defaultSnapshotMode?: SnapshotMode;
  outputs?: readonly QueryTemplateOutput[];
  steps: readonly QueryTemplateStep[];
}

const requestPort = (
  valueKind: PortRequirement["valueKind"] = "ANY",
  unitSemantics: PortRequirement["unitSemantics"] = "UNSPECIFIED"
): PortRequirement => ({
  name: "request",
  valueKind,
  unitSemantics
});

const resultPort = (
  valueKind: PortRequirement["valueKind"] = "ANY",
  unitSemantics: PortRequirement["unitSemantics"] = "UNSPECIFIED"
): PortRequirement => ({
  name: "result",
  valueKind,
  unitSemantics
});

const stringLiteralPort: SchemaPort = {
  schemaUri: "urn:gowm:v0.2:value:string",
  schemaHash: "sha256:a71d355802de7ff21b9c9d9214a1ba71b3648866bcf1b7c0f4ff3b656485c6d5",
  valueKind: "ANY",
  unitSemantics: "UNSPECIFIED"
};

const arrayLiteralPort: SchemaPort = {
  schemaUri: "urn:gowm:v0.2:value:array",
  schemaHash: "sha256:8e1e4dd66e9483d8341c51dc5ec424d8e6510ae35cdbc53040d0bab497459945",
  valueKind: "ANY",
  unitSemantics: "UNSPECIFIED"
};

const objectLiteralPort: SchemaPort = {
  schemaUri: "urn:gowm:v0.2:value:object",
  schemaHash: "sha256:a874188523644975b2d758a153c3b6fafbafd5b107133b30b9abf4055ae1809c",
  valueKind: "ANY",
  unitSemantics: "UNSPECIFIED"
};

const numberLiteralPort: SchemaPort = {
  schemaUri: "urn:gowm:v0.2:value:number",
  schemaHash: "sha256:f0bbdee8d99cf6777316260a88948dcb4290389c3a80268ae3cbbc4835970348",
  valueKind: "ANY",
  unitSemantics: "UNSPECIFIED"
};

const schemaVersionLiteral: QueryTemplateLiteralBinding = {
  inputName: "schemaVersion",
  value: "1.0",
  targetPath: "/schemaVersion",
  port: stringLiteralPort
};

function contract(
  operationKey: string,
  values: Omit<RequirementContract, "allowedOperationKeys" | "selectionPriority">
): RequirementContract {
  return {
    ...values,
    allowedOperationKeys: [operationKey],
    selectionPriority: [operationKey]
  };
}

const resolveReference: QueryTemplateStep = {
  stepId: "resolve-reference",
  costWeight: 1,
  failurePolicy: "FAIL_FAST",
  links: [],
  requirement: contract("reference.resolve@1.0", {
    domain: "REFERENCE",
    relationSemantics: ["RESOLVES_TO"],
    acceptedReferenceKinds: [],
    producedReferenceKinds: ["WORLD_OBJECT"],
    spatialSemantics: "NONE",
    timeSemantics: "SNAPSHOT",
    resultNature: "FACT",
    inputPorts: [requestPort()],
    outputPorts: [{ name: "candidateReferenceKey", valueKind: "REFERENCE_KEY", unitSemantics: "UNSPECIFIED" }]
  })
};

const referenceLink: QueryTemplateLink = {
  sourceStepId: "resolve-reference",
  outputPort: "candidateReferenceKey",
  inputName: "referenceKey",
  targetPath: "/referenceKey"
};

const geometryLink: QueryTemplateLink = {
  sourceStepId: "read-geometry",
  outputPort: "geometry",
  inputName: "geometry",
  targetPath: "/geometry"
};

function worldFactStep(
  stepId: string,
  operationId: string,
  relations: readonly string[],
  outputPorts: readonly PortRequirement[] = [resultPort()]
): QueryTemplateStep {
  return {
    stepId,
    costWeight: 2,
    failurePolicy: "FAIL_FAST",
    links: [referenceLink],
    literalBindings: [schemaVersionLiteral],
    requirement: contract(`${operationId}@1.0`, {
      domain: "WORLD_STATE",
      relationSemantics: relations,
      acceptedReferenceKinds: ["WORLD_OBJECT"],
      producedReferenceKinds: ["WORLD_OBJECT"],
      spatialSemantics: "NONE",
      timeSemantics: "SNAPSHOT",
      resultNature: "FACT",
      inputPorts: [requestPort()],
      outputPorts
    })
  };
}

const readGeometry = worldFactStep("read-geometry", "world.get-geometry", ["HAS_GEOMETRY"], [
  { name: "geometry", valueKind: "GEOMETRY", unitSemantics: "ANGULAR_DEGREES" }
]);

const readCurrentPosition = worldFactStep("read-current-position", "world.get-current-state", [], [
  { name: "positionCoordinates", valueKind: "ANY", unitSemantics: "ANGULAR_DEGREES" }
]);

const positionCoordinatesLink: QueryTemplateLink = {
  sourceStepId: "read-current-position",
  outputPort: "positionCoordinates",
  inputName: "location",
  targetPath: "/location"
};

function spatialStep(
  stepId: string,
  operationId: string,
  relation: string,
  link: QueryTemplateLink,
  producedReferenceKinds: readonly string[] = ["WORLD_OBJECT"],
  requestBindings: readonly QueryTemplateRequestBinding[] = []
): QueryTemplateStep {
  return {
    stepId,
    costWeight: 4,
    failurePolicy: "FAIL_FAST",
    links: [link],
    requestBindings,
    requirement: contract(`${operationId}@1.0`, {
      domain: "SPATIAL",
      relationSemantics: [relation],
      acceptedReferenceKinds: [],
      producedReferenceKinds,
      spatialSemantics: "EXACT",
      timeSemantics: "SNAPSHOT",
      resultNature: "FACT",
      inputPorts: [requestPort()],
      outputPorts: [resultPort("ROW_SET")]
    })
  };
}

const gdpsProductBinding: QueryTemplateRequestBinding = {
  inputName: "explicitProductId",
  path: "/explicitProductId",
  targetPath: "/productId",
  port: stringLiteralPort,
  optional: true,
  literalFromParameter: true
};

const gdpsDescriptorBindings: readonly QueryTemplateRequestBinding[] = [{
  inputName: "productType", path: "/productType", targetPath: "/productType", port: stringLiteralPort,
  literalFromParameter: true
}, {
  inputName: "productProfile", path: "/productProfile", targetPath: "/productProfile", port: stringLiteralPort,
  literalFromParameter: true
}, gdpsProductBinding];

const classCodesBinding: QueryTemplateRequestBinding = {
  inputName: "classCodes", path: "/classCodes", targetPath: "/classCodes", port: arrayLiteralPort,
  literalFromParameter: true
};
const rangesBinding: QueryTemplateRequestBinding = {
  inputName: "ranges", path: "/ranges", targetPath: "/ranges", port: arrayLiteralPort,
  literalFromParameter: true
};
const propertyFiltersBinding: QueryTemplateRequestBinding = {
  inputName: "propertyFilters", path: "/propertyFilters", targetPath: "/propertyFilters", port: objectLiteralPort,
  optional: true, literalFromParameter: true
};
const platformProfileBinding: QueryTemplateRequestBinding = {
  inputName: "platformProfile", path: "/platformProfile", targetPath: "/platformProfile", port: stringLiteralPort,
  optional: true, literalFromParameter: true
};

function genericGdpsStep(
  stepId: string,
  operationId: string,
  semantics: Pick<RequirementContract, "domain" | "relationSemantics" | "resultNature">,
  link: QueryTemplateLink,
  requestBindings: readonly QueryTemplateRequestBinding[] = [],
  literalBindings: readonly QueryTemplateLiteralBinding[] = []
): QueryTemplateStep {
  return {
    stepId,
    costWeight: 4,
    failurePolicy: "FAIL_FAST",
    links: [link],
    requestBindings: [...gdpsDescriptorBindings, ...requestBindings, platformProfileBinding],
    literalBindings,
    requirement: contract(`${operationId}@1.0`, {
      domain: semantics.domain,
      relationSemantics: semantics.relationSemantics,
      acceptedReferenceKinds: [],
      producedReferenceKinds: [],
      spatialSemantics: "EXACT",
      timeSemantics: "CURRENT",
      resultNature: semantics.resultNature,
      inputPorts: [requestPort()],
      outputPorts: [resultPort()]
    })
  };
}

const geoJsonPointType: QueryTemplateLiteralBinding = {
  inputName: "pointType",
  value: "Point",
  targetPath: "/point/type",
  port: stringLiteralPort
};

function gdpsPointStep(
  stepId: string,
  operationId: string,
  domain: "SPATIAL" | "ANALYSIS",
  resultNature: "FACT" | "DERIVED",
  extraRequestBindings: readonly QueryTemplateRequestBinding[] = [],
  relationSemantics: readonly string[] = ["DESCRIBES"]
): QueryTemplateStep {
  return {
    stepId,
    costWeight: 3,
    failurePolicy: "FAIL_FAST",
    links: [{
      sourceStepId: "read-current-position",
      outputPort: "positionCoordinates",
      inputName: "pointCoordinates",
      targetPath: "/point/coordinates"
    }],
    requestBindings: [gdpsProductBinding, ...extraRequestBindings],
    literalBindings: [geoJsonPointType],
    requirement: contract(`${operationId}@1.0`, {
      domain,
      relationSemantics,
      acceptedReferenceKinds: [],
      producedReferenceKinds: [],
      spatialSemantics: "EXACT",
      timeSemantics: "CURRENT",
      resultNature,
      inputPorts: [{ name: "operationInput", valueKind: "ANY", unitSemantics: "UNSPECIFIED" }],
      outputPorts: [resultPort()]
    })
  };
}

function gdpsAreaStep(
  stepId: string,
  operationId: string,
  domain: "SPATIAL" | "ANALYSIS"
): QueryTemplateStep {
  return {
    stepId,
    costWeight: 4,
    failurePolicy: "FAIL_FAST",
    links: [{
      sourceStepId: "read-geometry",
      outputPort: "geometry",
      inputName: "selector",
      targetPath: "/selector"
    }],
    requestBindings: [gdpsProductBinding],
    requirement: contract(`${operationId}@1.0`, {
      domain,
      relationSemantics: ["INSIDE"],
      acceptedReferenceKinds: [],
      producedReferenceKinds: [],
      spatialSemantics: "EXACT",
      timeSemantics: "CURRENT",
      resultNature: "DERIVED",
      inputPorts: [{ name: "operationInput", valueKind: "ANY", unitSemantics: "UNSPECIFIED" }],
      // GDPS exposes a generic result envelope here; the operation schema,
      // not the capability port kind, discriminates FeatureCollection values.
      outputPorts: [resultPort()]
    })
  };
}

const nearestApproachStep: QueryTemplateStep = {
  stepId: "nearest-approach",
  costWeight: 3,
  failurePolicy: "FAIL_FAST",
  links: [],
  requirement: contract("stas.nearest-approach@1.0", {
    domain: "TEMPORAL",
    relationSemantics: [],
    acceptedReferenceKinds: [],
    producedReferenceKinds: [],
    spatialSemantics: "NONE",
    timeSemantics: "INTERVAL",
    resultNature: "DERIVED",
    inputPorts: [requestPort()],
    outputPorts: [resultPort()]
  })
};

function nearestApproachContextStep(
  stepId: string,
  productType: "SLOPE" | "LAND_COVER",
  productProfile: "DEGREE" | "DEFAULT"
): QueryTemplateStep {
  return {
    stepId,
    costWeight: 3,
    failurePolicy: "FAIL_FAST",
    links: [{
      sourceStepId: "nearest-approach",
      outputPort: "result",
      sourcePath: "/result/shortest_line/coordinates/0",
      inputName: "pointCoordinates",
      targetPath: "/point/coordinates"
    }],
    literalBindings: [
      geoJsonPointType,
      { inputName: "productType", value: productType, targetPath: "/productType", port: stringLiteralPort },
      { inputName: "productProfile", value: productProfile, targetPath: "/productProfile", port: stringLiteralPort }
    ],
    requirement: contract("geo-raster.sample@1.0", {
      domain: "ANALYSIS",
      relationSemantics: ["DESCRIBES"],
      acceptedReferenceKinds: [],
      producedReferenceKinds: [],
      spatialSemantics: "EXACT",
      timeSemantics: "CURRENT",
      resultNature: "FACT",
      inputPorts: [requestPort()],
      outputPorts: [resultPort()]
    })
  };
}

export const queryTemplateRules: readonly QueryTemplateRule[] = [
  {
    templateId: "stas-nearest-approach-with-gdps-context",
    pattern: "STAS_NEAREST_APPROACH_WITH_GDPS_CONTEXT",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    authorizationRecipeId: "stas-nearest-approach-gdps-current-context",
    descriptorAuthorizationRequired: false,
    requiresTrustedOperationInput: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    outputs: [
      { name: "temporalEvidence", sourceStepId: "nearest-approach", outputPort: "result" },
      { name: "slopeEvidence", sourceStepId: "slope-context", outputPort: "result" },
      { name: "landCoverEvidence", sourceStepId: "land-cover-context", outputPort: "result" }
    ],
    steps: [
      nearestApproachStep,
      nearestApproachContextStep("slope-context", "SLOPE", "DEGREE"),
      nearestApproachContextStep("land-cover-context", "LAND_COVER", "DEFAULT")
    ]
  },
  {
    templateId: "reference-identity",
    pattern: "REFERENCE_IDENTITY",
    maturity: "STABLE",
    allowDegraded: false,
    steps: [
      resolveReference,
      {
        stepId: "validate-reference",
        costWeight: 1,
        failurePolicy: "FAIL_FAST",
        links: [referenceLink],
        requirement: contract("reference.validate@1.0", {
          domain: "PLATFORM",
          relationSemantics: ["VALIDATES"],
          acceptedReferenceKinds: ["WORLD_OBJECT"],
          producedReferenceKinds: [],
          spatialSemantics: "NONE",
          timeSemantics: "SNAPSHOT",
          resultNature: "VALIDATION",
          inputPorts: [requestPort()],
          outputPorts: [resultPort("ROW_SET")]
        })
      }
    ]
  },
  {
    templateId: "reference-current-state",
    pattern: "REFERENCE_CURRENT_STATE",
    maturity: "STABLE",
    allowDegraded: false,
    steps: [resolveReference, worldFactStep("read-current-state", "world.get-current-state", [])]
  },
  {
    templateId: "reference-geometry",
    pattern: "REFERENCE_GEOMETRY",
    maturity: "STABLE",
    allowDegraded: false,
    steps: [resolveReference, readGeometry]
  },
  {
    templateId: "reference-provenance",
    pattern: "REFERENCE_PROVENANCE",
    maturity: "STABLE",
    allowDegraded: false,
    steps: [resolveReference, worldFactStep("read-provenance", "world.get-provenance", [])]
  },
  {
    templateId: "catalog-search",
    pattern: "CATALOG_SEARCH",
    maturity: "STABLE",
    allowDegraded: true,
    steps: [{
      stepId: "search-catalog",
      costWeight: 2,
      failurePolicy: "ALLOW_PARTIAL",
      links: [],
      requirement: contract("catalog.search@1.0", {
        domain: "CATALOG",
        relationSemantics: ["DISCOVERS_DATA_PRODUCT"],
        acceptedReferenceKinds: [],
        producedReferenceKinds: ["DATASET"],
        spatialSemantics: "NONE",
        timeSemantics: "SNAPSHOT",
        resultNature: "CATALOG",
        inputPorts: [requestPort()],
        outputPorts: [resultPort("ROW_SET")]
      })
    }]
  },
  {
    templateId: "reference-nearby",
    pattern: "REFERENCE_NEARBY",
    maturity: "STABLE",
    allowDegraded: false,
    steps: [
      resolveReference,
      readCurrentPosition,
      spatialStep("find-nearby", "spatial.find-nearby", "NEAR", {
        ...positionCoordinatesLink
      }, ["WORLD_OBJECT"], [{
        inputName: "radiusM",
        path: "/distanceM",
        targetPath: "/radiusM",
        port: {
          schemaUri: "urn:gowm:v0.2:value:number",
          schemaHash: "sha256:f0bbdee8d99cf6777316260a88948dcb4290389c3a80268ae3cbbc4835970348",
          valueKind: "ANY",
          unitSemantics: "UNSPECIFIED"
        }
      }])
    ]
  },
  {
    templateId: "reference-in-area",
    pattern: "REFERENCE_IN_AREA",
    maturity: "STABLE",
    allowDegraded: false,
    steps: [
      resolveReference,
      readGeometry,
      spatialStep("find-in-area", "spatial.find-in-area", "INSIDE", geometryLink)
    ]
  },
  {
    templateId: "reference-intersections",
    pattern: "REFERENCE_INTERSECTIONS",
    maturity: "STABLE",
    allowDegraded: false,
    steps: [
      resolveReference,
      readGeometry,
      spatialStep("find-intersections", "spatial.find-intersections", "INTERSECTS", geometryLink)
    ]
  },
  {
    templateId: "prior-result-revalidation",
    pattern: "PRIOR_RESULT_REVALIDATION",
    maturity: "STABLE",
    allowDegraded: false,
    defaultSnapshotMode: "PINNED",
    steps: [{
      stepId: "validate-reference",
      costWeight: 1,
      failurePolicy: "FAIL_FAST",
      links: [],
      requirement: contract("reference.validate@1.0", {
        domain: "PLATFORM",
        relationSemantics: ["VALIDATES"],
        acceptedReferenceKinds: ["WORLD_OBJECT"],
        producedReferenceKinds: [],
        spatialSemantics: "NONE",
        timeSemantics: "SNAPSHOT",
        resultNature: "VALIDATION",
        inputPorts: [requestPort()],
        outputPorts: [resultPort("ROW_SET")]
      })
    }, {
      stepId: "validate-snapshot",
      costWeight: 1,
      failurePolicy: "FAIL_FAST",
      links: [{
        sourceStepId: "validate-reference",
        outputPort: "result",
        inputName: "validationResult",
        targetPath: "/validationResult"
      }],
      requirement: contract("snapshot.validate@1.0", {
        domain: "PLATFORM",
        relationSemantics: ["VALIDATES_SNAPSHOT"],
        acceptedReferenceKinds: [],
        producedReferenceKinds: [],
        spatialSemantics: "NONE",
        timeSemantics: "SNAPSHOT",
        resultNature: "VALIDATION",
        inputPorts: [requestPort()],
        outputPorts: [resultPort()]
      })
    }]
  },
  {
    templateId: "reference-event-timeline",
    pattern: "REFERENCE_EVENT_TIMELINE",
    maturity: "PREVIEW",
    allowDegraded: false,
    steps: [
      resolveReference,
      worldFactStep("read-event-timeline", "world.get-event-timeline", [], [resultPort("ROW_SET")])
    ]
  },
  {
    templateId: "reference-containing-area",
    pattern: "REFERENCE_CONTAINING_AREA",
    maturity: "PREVIEW",
    allowDegraded: false,
    steps: [
      resolveReference,
      readGeometry,
      spatialStep(
        "find-containing-area",
        "spatial.find-containing-area",
        "CONTAINS",
        geometryLink,
        ["LAYER_FEATURE"]
      )
    ]
  },
  {
    templateId: "h3-neighborhood",
    pattern: "H3_NEIGHBORHOOD",
    maturity: "PREVIEW",
    allowDegraded: false,
    steps: [{
      stepId: "h3-neighborhood",
      costWeight: 1,
      failurePolicy: "FAIL_FAST",
      links: [],
      requirement: contract("h3.neighborhood.disk@1.0", {
        domain: "H3",
        relationSemantics: [],
        acceptedReferenceKinds: [],
        producedReferenceKinds: [],
        spatialSemantics: "CANDIDATE",
        timeSemantics: "NONE",
        resultNature: "DERIVED",
        inputPorts: [requestPort("H3_CELL_SET", "DISCRETE")],
        outputPorts: [resultPort("H3_CELL_SET", "DISCRETE")]
      })
    }]
  },
  {
    templateId: "h3-exact-verify",
    pattern: "H3_EXACT_VERIFY",
    maturity: "PREVIEW",
    allowDegraded: false,
    steps: [{
      stepId: "candidate-cover",
      costWeight: 1,
      failurePolicy: "FAIL_FAST",
      links: [],
      requirement: contract("h3.geometry.cover@1.0", {
        domain: "H3",
        relationSemantics: ["CANDIDATE_COVER"],
        acceptedReferenceKinds: [],
        producedReferenceKinds: [],
        spatialSemantics: "EXACT",
        timeSemantics: "NONE",
        resultNature: "DERIVED",
        inputPorts: [requestPort("GEOMETRY", "ANGULAR_DEGREES")],
        outputPorts: [resultPort("H3_CELL_SET", "DISCRETE")],
        allowCandidateWithExactVerification: true
      })
    }]
  },
  {
    templateId: "operational-correlation-timeline",
    pattern: "EXTERNAL_CORRELATION_TIMELINE",
    maturity: "PREVIEW",
    allowDegraded: false,
    steps: [{
      stepId: "resolve-correlation",
      costWeight: 2,
      failurePolicy: "FAIL_FAST",
      links: [],
      requirement: contract("correlation.resolve@1.0", {
        domain: "TEMPORAL",
        relationSemantics: ["CORRELATES_WITH"],
        acceptedReferenceKinds: [],
        producedReferenceKinds: ["OPERATIONAL_TASK"],
        spatialSemantics: "NONE",
        timeSemantics: "INTERVAL",
        resultNature: "PROJECTION",
        inputPorts: [requestPort()],
        outputPorts: [resultPort()]
      })
    }]
  },
  {
    templateId: "predicate-evaluation",
    pattern: "EXTERNAL_PREDICATE_EVALUATION",
    maturity: "PREVIEW",
    allowDegraded: false,
    steps: [{
      stepId: "evaluate-predicate",
      costWeight: 2,
      failurePolicy: "FAIL_FAST",
      links: [],
      requirement: contract("predicate.evaluate@1.0", {
        domain: "ANALYSIS",
        relationSemantics: ["EVALUATES_PREDICATE"],
        acceptedReferenceKinds: [],
        producedReferenceKinds: [],
        spatialSemantics: "NONE",
        timeSemantics: "SNAPSHOT",
        resultNature: "VALIDATION",
        inputPorts: [requestPort()],
        outputPorts: [resultPort()]
      })
    }]
  },
  {
    templateId: "gdps-validate-source-currentness",
    pattern: "GDPS_VALIDATE_SOURCE_CURRENTNESS",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    authorizationRecipeId: "gdps-check-current-geo-product",
    descriptorAuthorizationRequired: false,
    allowDegraded: false,
    defaultSnapshotMode: "LATEST_AT_START",
    steps: [{
      stepId: "check-current-product",
      costWeight: 1,
      failurePolicy: "FAIL_FAST",
      links: [],
      requirement: contract("geo-product.check-current@1.0", {
        domain: "PLATFORM",
        relationSemantics: ["VALIDATES"],
        acceptedReferenceKinds: [],
        producedReferenceKinds: [],
        spatialSemantics: "NONE",
        timeSemantics: "CURRENT",
        resultNature: "VALIDATION",
        inputPorts: [{ name: "operationInput", valueKind: "ANY", unitSemantics: "UNSPECIFIED" }],
        outputPorts: [resultPort()]
      })
    }]
  },
  {
    templateId: "gdps-land-cover-at-reference",
    pattern: "GDPS_LAND_COVER_AT_REFERENCE",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readCurrentPosition,
      gdpsPointStep("read-land-cover", "landcover.get-class", "SPATIAL", "FACT")]
  },
  {
    templateId: "gdps-wetlands-in-area",
    pattern: "GDPS_WETLANDS_IN_AREA",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readGeometry,
      gdpsAreaStep("find-wetlands", "hydrology.find-wetlands", "SPATIAL")]
  },
  {
    templateId: "gdps-obstacles-near-reference",
    pattern: "GDPS_OBSTACLES_NEAR_REFERENCE",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readCurrentPosition,
      gdpsPointStep("find-obstacles", "obstacle.find-nearby", "SPATIAL", "DERIVED", [{
        inputName: "distanceMetres",
        path: "/distanceMetres",
        targetPath: "/distanceMetres",
        port: {
          schemaUri: "urn:gowm:v0.2:value:number",
          schemaHash: "sha256:f0bbdee8d99cf6777316260a88948dcb4290389c3a80268ae3cbbc4835970348",
          valueKind: "ANY",
          unitSemantics: "LINEAR_METERS"
        },
        literalFromParameter: true
      }], ["NEAR"])]
  },
  {
    templateId: "gdps-blocked-areas-in-area",
    pattern: "GDPS_BLOCKED_AREAS_IN_AREA",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readGeometry,
      gdpsAreaStep("find-blocked-areas", "traversability.find-blocked", "ANALYSIS")]
  },
  {
    templateId: "gdps-high-ground-in-area",
    pattern: "GDPS_HIGH_GROUND_IN_AREA",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readGeometry,
      gdpsAreaStep("find-high-ground", "terrain.find-high-ground", "SPATIAL")]
  },
  {
    templateId: "gdps-elevation-at-reference",
    pattern: "GDPS_ELEVATION_AT_REFERENCE",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readCurrentPosition,
      gdpsPointStep("read-elevation", "elevation.sample", "ANALYSIS", "FACT")]
  },
  {
    templateId: "gdps-traversability-explain-at-reference",
    pattern: "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readCurrentPosition,
      gdpsPointStep("explain-traversability", "traversability.explain", "ANALYSIS", "DERIVED")]
  },
  {
    templateId: "gdps-generic-sample-value",
    pattern: "GDPS_GENERIC_SAMPLE_VALUE",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readCurrentPosition,
      genericGdpsStep("sample-product", "geo-raster.sample", {
        domain: "ANALYSIS", relationSemantics: ["DESCRIBES"], resultNature: "FACT"
      }, {
        sourceStepId: "read-current-position", outputPort: "positionCoordinates",
        inputName: "pointCoordinates", targetPath: "/point/coordinates"
      }, [], [geoJsonPointType])]
  },
  {
    templateId: "gdps-generic-profile-value",
    pattern: "GDPS_GENERIC_PROFILE_VALUE",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readGeometry,
      genericGdpsStep("profile-product", "geo-raster.profile", {
        domain: "ANALYSIS", relationSemantics: ["DESCRIBES"], resultNature: "DERIVED"
      }, {
        sourceStepId: "read-geometry", outputPort: "geometry", inputName: "line", targetPath: "/line"
      })]
  },
  {
    templateId: "gdps-generic-find-class",
    pattern: "GDPS_GENERIC_FIND_CLASS",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readGeometry,
      genericGdpsStep("find-product-class", "geo-raster.find-by-class", {
        domain: "SPATIAL", relationSemantics: ["INSIDE"], resultNature: "DERIVED"
      }, { ...geometryLink, targetPath: "/selector" }, [classCodesBinding])]
  },
  {
    templateId: "gdps-generic-find-range",
    pattern: "GDPS_GENERIC_FIND_RANGE",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readGeometry,
      genericGdpsStep("find-product-range", "geo-raster.find-by-range", {
        domain: "SPATIAL", relationSemantics: ["INSIDE"], resultNature: "DERIVED"
      }, { ...geometryLink, targetPath: "/selector" }, [rangesBinding])]
  },
  {
    templateId: "gdps-generic-vector-in-area",
    pattern: "GDPS_GENERIC_VECTOR_IN_AREA",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readGeometry,
      genericGdpsStep("find-vector-in-area", "geo-vector.find-in-area", {
        domain: "SPATIAL", relationSemantics: ["INSIDE"], resultNature: "DERIVED"
      }, { ...geometryLink, targetPath: "/selector" }, [propertyFiltersBinding])]
  },
  {
    templateId: "gdps-generic-vector-nearby",
    pattern: "GDPS_GENERIC_VECTOR_NEARBY",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readCurrentPosition,
      genericGdpsStep("find-vector-nearby", "geo-vector.find-nearby", {
        domain: "SPATIAL", relationSemantics: ["NEAR"], resultNature: "DERIVED"
      }, {
        sourceStepId: "read-current-position", outputPort: "positionCoordinates",
        inputName: "pointCoordinates", targetPath: "/point/coordinates"
      }, [{
        inputName: "distanceMetres", path: "/distanceM", targetPath: "/distanceMetres",
        port: numberLiteralPort, literalFromParameter: true
      }, propertyFiltersBinding],
      [geoJsonPointType])]
  },
  {
    templateId: "gdps-generic-vector-intersects",
    pattern: "GDPS_GENERIC_VECTOR_INTERSECTS",
    maturity: "PREVIEW",
    previewAuthorizationRequired: true,
    allowDegraded: false,
    defaultSnapshotMode: "BEST_EFFORT",
    steps: [resolveReference, readGeometry,
      genericGdpsStep("find-vector-intersections", "geo-vector.find-intersections", {
        domain: "SPATIAL", relationSemantics: ["INTERSECTS"], resultNature: "DERIVED"
      }, { ...geometryLink, targetPath: "/selector" }, [propertyFiltersBinding])]
  }
] as const;

export function semanticRequirementFor(
  rule: QueryTemplateRule,
  step: QueryTemplateStep,
  requiredForProduct: string,
  snapshotMode: SnapshotMode
): SemanticCapabilityRequirement {
  return {
    requirementId: `${rule.templateId}:${step.stepId}`,
    semanticCapability: `${rule.pattern}:${step.stepId}`,
    requiredForProduct,
    snapshotMode,
    ...step.requirement
  };
}
