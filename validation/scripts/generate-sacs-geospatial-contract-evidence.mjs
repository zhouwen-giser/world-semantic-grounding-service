import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const contractRoot = join(repositoryRoot, "contracts", "wsgs-v0.2.1-sacs-geospatial");
const exampleRoot = join(contractRoot, "examples");
const compatibilityRoot = join(contractRoot, "compatibility", "sacs-pr17");
const legacyRoot = join(repositoryRoot, "contracts", "wsgs-v0.1");
const legacySchemaRoot = join(legacyRoot, "contracts");
const legacyLockPath = join(legacyRoot, "contract-lock.json");
const legacyBaselinePath = join(
  contractRoot,
  "baselines",
  "sacs-wsgs-grounding-1.0-contract-lock.json"
);
const releaseLockPath = join(contractRoot, "contract-release-lock.json");
const reportRoot = join(repositoryRoot, "reports", "sacs-geospatial-v1");
const write = process.argv.includes("--write");

const legacyLockSha256 = "sha256:25d70b9b85b356f116a5ee2a881bae2b07ad41aa73a0e4786b77fba24876bc40";
const sacsConsumerHead = "951a1d81d640d24de60ce6eacc8bb6f95eb6ac35";
const sacsWorldFindingLfHash = "sha256:c8c6e5392f266ba56bf525fd09cf0167373e2616b059bb4d262d99c644b3aafe";
const sacsSourceProductLfHash = "sha256:ec0076a8bf292acc0a0798148704c2380a17074d6b8e257e102f4d24c5560b66";
const sacsConsumerFixtureProjectionHash = "sha256:1490de261dd8e45ddbf8604c8da6cbb2e08b3fa57bf0c7a415bf4a1ce6c182df";
const generator = {
  name: "generate-sacs-geospatial-contract-evidence",
  version: "1.0.0"
};

const schemaNames = [
  "capabilities-response-v1.1.schema.json",
  "geospatial-findings.schema.json",
  "grounding-result-extension.schema.json",
  "source-currentness-request.schema.json",
  "source-currentness-result.schema.json",
  "source-product.schema.json",
  "structured-selection-request.schema.json",
  "structured-selection-result.schema.json",
  "typed-gap.schema.json",
  "world-finding.schema.json"
];

const exampleSchema = new Map([
  ["capabilities-response-v1.1.json", "capabilities-response-v1.1.schema.json"],
  ["geospatial-findings-point-measurement.json", "geospatial-findings.schema.json"],
  ["grounding-result-with-geospatial-findings.json", "grounding-result-extension.schema.json"],
  ["source-currentness-request.json", "source-currentness-request.schema.json"],
  ["source-currentness-result-changed.json", "source-currentness-result.schema.json"],
  ["source-currentness-result-current.json", "source-currentness-result.schema.json"],
  ["source-currentness-result-not-available.json", "source-currentness-result.schema.json"],
  ["source-currentness-result-unknown.json", "source-currentness-result.schema.json"],
  ["source-product.json", "source-product.schema.json"],
  ["structured-selection-request.json", "structured-selection-request.schema.json"],
  ["structured-selection-result-reference-key.json", "structured-selection-result.schema.json"],
  ["structured-selection-result-token.json", "structured-selection-result.schema.json"],
  ["typed-gap.json", "typed-gap.schema.json"],
  ["world-finding-catalog.json", "world-finding.schema.json"],
  ["world-finding-point-classification.json", "world-finding.schema.json"],
  ["world-finding-point-measurement.json", "world-finding.schema.json"],
  ["world-finding-profile.json", "world-finding.schema.json"],
  ["world-finding-qualified-explanation.json", "world-finding.schema.json"],
  ["world-finding-spatial-feature-collection.json", "world-finding.schema.json"]
]);

function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

function bytes(path) {
  if (!existsSync(path)) fail("MISSING_ARTIFACT", relative(repositoryRoot, path));
  return readFileSync(path);
}

function text(path) {
  return bytes(path).toString("utf8");
}

function json(path) {
  return JSON.parse(text(path));
}

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizedLf(value) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function sha256Lf(path) {
  return sha256(Buffer.from(normalizedLf(text(path)), "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalHash(value) {
  return sha256(Buffer.from(JSON.stringify(canonicalize(value)), "utf8"));
}

function jsonDocument(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeOrCheck(path, content) {
  const canonical = normalizedLf(content);
  if (write) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, canonical, "utf8");
    return;
  }
  if (normalizedLf(text(path)) !== canonical) {
    fail("GENERATED_ARTIFACT_DRIFT", relative(repositoryRoot, path).replaceAll("\\", "/"));
  }
}

function schemaId(schema, label) {
  if (typeof schema.$id !== "string" || schema.$id.length === 0) {
    fail("SCHEMA_ID_MISSING", label);
  }
  return schema.$id;
}

function rewriteRelativeRefs(value, idsByName) {
  if (Array.isArray(value)) return value.map((entry) => rewriteRelativeRefs(entry, idsByName));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (
        key === "$ref" &&
        typeof entry === "string" &&
        !entry.startsWith("#") &&
        !/^[a-z][a-z0-9+.-]*:/iu.test(entry)
      ) {
        const [name, fragment] = entry.split("#", 2);
        const id = idsByName.get(name);
        if (id) return [key, `${id}${fragment === undefined ? "" : `#${fragment}`}`];
      }
      return [key, rewriteRelativeRefs(entry, idsByName)];
    })
  );
}

function schemaDocuments(root, names) {
  return names.map((name) => ({ name, schema: json(join(root, name)) }));
}

function assertPublishedObjectBoundariesClosed(schema, schemaName) {
  const visit = (value, path = "$") => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.type === "object" && value.additionalProperties !== false) {
      fail("OPEN_PUBLISHED_OBJECT_BOUNDARY", `${schemaName}:${path}`);
    }
    for (const [key, entry] of Object.entries(value)) visit(entry, `${path}.${key}`);
  };
  visit(schema);
}

function compileAuthoritativeSchemas() {
  const legacyNames = readdirSync(legacySchemaRoot)
    .filter((name) => name.endsWith(".schema.json"))
    .sort((left, right) => left.localeCompare(right));
  const legacyDocuments = schemaDocuments(legacySchemaRoot, legacyNames);
  const authoritativeDocuments = schemaDocuments(contractRoot, schemaNames);
  for (const { name, schema } of authoritativeDocuments) {
    assertPublishedObjectBoundariesClosed(schema, name);
  }
  const idsByName = new Map(
    [...legacyDocuments, ...authoritativeDocuments].map(({ name, schema }) => [name, schemaId(schema, name)])
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  for (const { name, schema } of [...legacyDocuments, ...authoritativeDocuments]) {
    ajv.addSchema(rewriteRelativeRefs(schema, idsByName), schemaId(schema, name));
  }
  const validators = new Map();
  for (const { name, schema } of authoritativeDocuments) {
    const validator = ajv.getSchema(schemaId(schema, name));
    if (!validator) fail("SCHEMA_COMPILE_FAILED", name);
    validators.set(name, validator);
  }
  const legacyResult = ajv.getSchema("urn:wsgs:v0.1:grounding-result");
  if (!legacyResult) fail("SCHEMA_COMPILE_FAILED", "legacy grounding-result");
  return { validators, legacyResult };
}

function assertValid(validator, value, caseId) {
  if (!validator(value)) {
    fail("POSITIVE_SCHEMA_CASE_FAILED", `${caseId}: ${JSON.stringify(validator.errors ?? [])}`);
  }
}

function assertInvalid(validator, value, caseId) {
  if (validator(value)) fail("NEGATIVE_SCHEMA_CASE_ACCEPTED", caseId);
}

function validateLegacyLock() {
  const actualLockHash = sha256(bytes(legacyLockPath));
  if (actualLockHash !== legacyLockSha256) {
    fail("LEGACY_CONTRACT_LOCK_DRIFT", `${actualLockHash} != ${legacyLockSha256}`);
  }
  const lock = json(legacyLockPath);
  const artifacts = Object.entries(lock.artifacts ?? {});
  for (const [path, expected] of artifacts) {
    const actual = sha256(bytes(join(legacyRoot, path)));
    if (actual !== expected) fail("LEGACY_CONTRACT_ARTIFACT_DRIFT", path);
  }
  if (write) {
    mkdirSync(dirname(legacyBaselinePath), { recursive: true });
    writeFileSync(legacyBaselinePath, bytes(legacyLockPath));
  } else if (!bytes(legacyBaselinePath).equals(bytes(legacyLockPath))) {
    fail("LEGACY_BASELINE_COPY_DRIFT", relative(repositoryRoot, legacyBaselinePath));
  }
  return {
    lock,
    actualLockHash,
    artifactCount: artifacts.length
  };
}

function validateVersionSurfaces() {
  if (text(join(repositoryRoot, "VERSION")).trim() !== "0.2.1") {
    fail("VERSION_SURFACE_DRIFT", "VERSION");
  }
  const rootManifest = json(join(repositoryRoot, "package.json"));
  if (rootManifest.version !== "0.2.1") fail("VERSION_SURFACE_DRIFT", "package.json");
  const lock = json(join(repositoryRoot, "package-lock.json"));
  if (lock.packages?.[""]?.version !== "0.2.1") fail("VERSION_SURFACE_DRIFT", "package-lock root");
  const records = [];
  for (const workspaceRoot of ["packages", "services"]) {
    const directory = join(repositoryRoot, workspaceRoot);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(directory, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const path = `${workspaceRoot}/${entry.name}`;
      const manifest = json(manifestPath);
      if (manifest.version !== "0.2.1") fail("VERSION_SURFACE_DRIFT", `${path}=${manifest.version}`);
      const internalDependencies = {};
      for (const dependencyGroup of ["dependencies", "devDependencies", "peerDependencies"]) {
        for (const [name, version] of Object.entries(manifest[dependencyGroup] ?? {})) {
          if (!name.startsWith("@wsgs/")) continue;
          if (version !== "0.2.1") fail("INTERNAL_DEPENDENCY_VERSION_DRIFT", `${path}:${name}=${version}`);
          internalDependencies[name] = version;
        }
      }
      const locked = lock.packages?.[path];
      if (!locked || locked.version !== "0.2.1") fail("LOCKFILE_WORKSPACE_VERSION_DRIFT", path);
      for (const [name, version] of Object.entries(internalDependencies)) {
        if (locked.dependencies?.[name] !== version) fail("LOCKFILE_INTERNAL_DEPENDENCY_DRIFT", `${path}:${name}`);
      }
      records.push({ path, name: manifest.name, version: manifest.version, internalDependencies });
    }
  }
  records.sort((left, right) => left.path.localeCompare(right.path));
  if (records.length !== 19) fail("WORKSPACE_MANIFEST_INVENTORY_DRIFT", String(records.length));
  const releaseSurfaces = [
    {
      path: "Dockerfile",
      expectedFragment: 'org.opencontainers.image.version="0.2.1"'
    },
    {
      path: "compose.yaml",
      expectedFragment: "WSGS_RUNTIME_IMAGE:-wsgs:0.2.1"
    },
    {
      path: "README.md",
      expectedFragment: "WSGS 0.2.1 development candidate"
    },
    {
      path: "CHANGELOG.md",
      expectedFragment: "## 0.2.1 candidate - 2026-08-30"
    }
  ];
  for (const surface of releaseSurfaces) {
    if (!text(join(repositoryRoot, surface.path)).includes(surface.expectedFragment)) {
      fail("RELEASE_SURFACE_DRIFT", `${surface.path}:${surface.expectedFragment}`);
    }
  }
  return {
    version: "0.2.1",
    workspaceManifestCount: records.length,
    records,
    releaseSurfaces,
    surfaceHash: canonicalHash({ records, releaseSurfaces })
  };
}

function validateExamples(validators) {
  const names = readdirSync(exampleRoot)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));
  if (names.length !== exampleSchema.size || names.some((name) => !exampleSchema.has(name))) {
    fail("EXAMPLE_INVENTORY_DRIFT", `expected ${exampleSchema.size}, received ${names.length}`);
  }
  for (const name of names) {
    const schemaName = exampleSchema.get(name);
    const validator = validators.get(schemaName);
    if (!validator) fail("EXAMPLE_SCHEMA_NOT_REGISTERED", `${name} -> ${schemaName}`);
    assertValid(validator, json(join(exampleRoot, name)), name);
  }

  const extension = json(join(exampleRoot, "geospatial-findings-point-measurement.json"));
  const profileHash = sha256(bytes(join(contractRoot, "geospatial-findings.schema.json")));
  if (extension.profileSchemaHash !== profileHash) fail("PROFILE_SCHEMA_HASH_DRIFT", "example profileSchemaHash");
  const sortedFindings = [...extension.findings].sort((left, right) => left.findingId.localeCompare(right.findingId));
  const sortedProducts = [...extension.sourceProducts].sort((left, right) => left.sourceProductId.localeCompare(right.sourceProductId));
  if (extension.findingSetHash !== canonicalHash(sortedFindings)) fail("FINDING_SET_HASH_DRIFT", "example");
  if (extension.sourceProductSetHash !== canonicalHash(sortedProducts)) fail("SOURCE_PRODUCT_SET_HASH_DRIFT", "example");
  return names;
}

function validateNegativeCases(validators, legacyResult) {
  const world = json(join(exampleRoot, "world-finding-point-measurement.json"));
  const spatial = json(join(exampleRoot, "world-finding-spatial-feature-collection.json"));
  const product = json(join(exampleRoot, "source-product.json"));
  const selection = json(join(exampleRoot, "structured-selection-result-reference-key.json"));
  const selectionRequest = json(join(exampleRoot, "structured-selection-request.json"));
  const gap = json(join(exampleRoot, "typed-gap.json"));
  const result = json(join(exampleRoot, "grounding-result-with-geospatial-findings.json"));
  const cases = [
    ["NEG_UNKNOWN_FINDING_KIND", "world-finding.schema.json", { ...clone(world), findingKind: "UNKNOWN" }],
    ["NEG_UNKNOWN_FINDING_FIELD", "world-finding.schema.json", { ...clone(world), hiddenFact: true }],
    ["NEG_EMPTY_EVIDENCE_IDS", "world-finding.schema.json", { ...clone(world), evidenceItemIds: [] }],
    ["NEG_SOURCE_PRODUCT_MISSING_CONTENT_HASH", "source-product.schema.json", (() => {
      const value = clone(product);
      delete value.contentHash;
      return value;
    })()],
    ["NEG_INVALID_REFERENCE_KEY", "world-finding.schema.json", (() => {
      const value = clone(spatial);
      value.features[0].referenceKey.id = "not-a-reference-key";
      return value;
    })()],
    ["NEG_REFERENCE_KEY_AND_TOKEN", "structured-selection-result.schema.json", {
      ...clone(selection),
      upstreamSelectionToken: "opaque-token"
    }],
    ["NEG_UNKNOWN_GAP_KIND", "typed-gap.schema.json", { ...clone(gap), gapKind: "UNKNOWN_GAP" }],
    ["NEG_INVALID_HASH", "source-product.schema.json", { ...clone(product), contentHash: "sha256:ABC" }],
    ["NEG_EXTENSION_WRONG_LOCATION", "grounding-result-extension.schema.json", (() => {
      const value = clone(result);
      value.execution.geospatialFindings = value.geospatialFindings;
      delete value.geospatialFindings;
      return value;
    })()],
    ["NEG_REQUEST_BODY_PRINCIPAL", "structured-selection-request.schema.json", {
      ...clone(selectionRequest),
      principalId: "request-body-authority"
    }]
  ];
  for (const [id, schemaName, value] of cases) {
    assertInvalid(validators.get(schemaName), value, id);
  }
  assertInvalid(legacyResult, result, "NEG_LEGACY_RESULT_REWRITTEN_WITH_EXTENSION");
  return [...cases.map(([id]) => id), "NEG_LEGACY_RESULT_REWRITTEN_WITH_EXTENSION"];
}

function validateSacsCompatibility(validators) {
  const sacsWorldPath = join(compatibilityRoot, "world-finding.schema.json");
  const sacsSourcePath = join(compatibilityRoot, "source-product.schema.json");
  if (sha256Lf(sacsWorldPath) !== sacsWorldFindingLfHash) fail("SACS_WORLD_FINDING_SNAPSHOT_DRIFT", sha256Lf(sacsWorldPath));
  if (sha256Lf(sacsSourcePath) !== sacsSourceProductLfHash) fail("SACS_SOURCE_PRODUCT_SNAPSHOT_DRIFT", sha256Lf(sacsSourcePath));
  const sacsAjv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(sacsAjv);
  const sacsWorld = sacsAjv.compile(json(sacsWorldPath));
  const sacsSource = sacsAjv.compile(json(sacsSourcePath));
  const findingExamples = [...exampleSchema.entries()]
    .filter(([name, schemaName]) => schemaName === "world-finding.schema.json")
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
  for (const name of findingExamples) {
    const value = json(join(exampleRoot, name));
    assertValid(sacsWorld, value, `WSGS_TO_SACS_${name}`);
    assertValid(validators.get("world-finding.schema.json"), value, `SACS_FIXTURE_TO_WSGS_${name}`);
  }
  const product = json(join(exampleRoot, "source-product.json"));
  assertValid(sacsSource, product, "WSGS_TO_SACS_source-product.json");
  const consumerFixtures = json(join(compatibilityRoot, "consumer-fixtures.json"));
  if (
    consumerFixtures.source?.headSha !== sacsConsumerHead ||
    consumerFixtures.source?.path !== "tests/world-explanation-fixtures.ts" ||
    consumerFixtures.source?.normalizedLfSha256 !== "sha256:f9ce9a1ecc6d01a9fbb4e8843e69d0f5063c4b3fdbecc8111321d67c72bb9ffc"
  ) {
    fail("SACS_FIXTURE_SOURCE_LOCK_DRIFT", "consumer-fixtures.json");
  }
  if (!Array.isArray(consumerFixtures.findings) || consumerFixtures.findings.length !== 6) {
    fail("SACS_FIXTURE_INVENTORY_DRIFT", "expected six findings");
  }
  if (!Array.isArray(consumerFixtures.sourceProducts) || consumerFixtures.sourceProducts.length !== 1) {
    fail("SACS_FIXTURE_INVENTORY_DRIFT", "expected one source product");
  }
  const actualProjectionHash = canonicalHash({
    findings: consumerFixtures.findings,
    sourceProducts: consumerFixtures.sourceProducts
  });
  if (actualProjectionHash !== sacsConsumerFixtureProjectionHash) {
    fail("SACS_FIXTURE_PROJECTION_DRIFT", `${actualProjectionHash} != ${sacsConsumerFixtureProjectionHash}`);
  }
  for (const [index, fixture] of consumerFixtures.findings.entries()) {
    assertValid(sacsWorld, fixture, `SACS_FIXTURE_SELF_${index + 1}`);
    assertValid(validators.get("world-finding.schema.json"), fixture, `SACS_FIXTURE_TO_WSGS_${index + 1}`);
  }
  for (const [index, fixture] of consumerFixtures.sourceProducts.entries()) {
    assertValid(sacsSource, fixture, `SACS_FIXTURE_SELF_SOURCE_${index + 1}`);
    assertValid(validators.get("source-product.schema.json"), fixture, `SACS_FIXTURE_TO_WSGS_SOURCE_${index + 1}`);
  }
  return {
    findingCaseCount: findingExamples.length,
    sourceProductCaseCount: 1,
    wsgsToSacsCaseCount: findingExamples.length + 1,
    sacsToWsgsCaseCount: findingExamples.length + 1
  };
}

const legacy = validateLegacyLock();
const versionSurfaces = validateVersionSurfaces();
const { validators, legacyResult } = compileAuthoritativeSchemas();
const exampleNames = validateExamples(validators);
const negativeCaseIds = validateNegativeCases(validators, legacyResult);
const compatibility = validateSacsCompatibility(validators);

const schemaHashes = Object.fromEntries(
  schemaNames.map((name) => [name, sha256(bytes(join(contractRoot, name)))])
);
const exampleHashes = Object.fromEntries(
  exampleNames.map((name) => [`examples/${name}`, sha256(bytes(join(exampleRoot, name)))])
);
const compatibilityHashes = {
  "compatibility/sacs-pr17/README.md": sha256Lf(join(compatibilityRoot, "README.md")),
  "compatibility/sacs-pr17/consumer-fixtures.json": sha256Lf(join(compatibilityRoot, "consumer-fixtures.json")),
  "compatibility/sacs-pr17/source-product.schema.json": sha256Lf(join(compatibilityRoot, "source-product.schema.json")),
  "compatibility/sacs-pr17/world-finding.schema.json": sha256Lf(join(compatibilityRoot, "world-finding.schema.json"))
};
const inputSetHash = canonicalHash({
  schemaHashes,
  exampleHashes,
  compatibilityHashes,
  legacyLockSha256,
  versionSurfaceHash: versionSurfaces.surfaceHash
});

const releaseLockArtifacts = Object.fromEntries(
  [
    ...schemaNames,
    ...exampleNames.map((name) => `examples/${name}`),
    "compatibility/sacs-pr17/README.md",
    "compatibility/sacs-pr17/consumer-fixtures.json",
    "compatibility/sacs-pr17/source-product.schema.json",
    "compatibility/sacs-pr17/world-finding.schema.json",
    "baselines/sacs-wsgs-grounding-1.0-contract-lock.json"
  ]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => [path, sha256(bytes(join(contractRoot, path)))])
);
const releaseLock = {
  lockVersion: "1.0",
  contractVersion: "sacs-wsgs-grounding/1.1",
  softwareVersion: "0.2.1",
  wireSchemaVersion: "1.0",
  profile: "sacs-wsgs-geospatial-findings/1.0",
  legacyContract: {
    contractVersion: "sacs-wsgs-grounding/1.0",
    lockFileSha256: legacyLockSha256,
    byteStable: true
  },
  artifacts: releaseLockArtifacts
};
writeOrCheck(releaseLockPath, jsonDocument(releaseLock));
const releaseLockHash = sha256(Buffer.from(jsonDocument(releaseLock), "utf8"));

const commonReport = {
  phase: "N01",
  generator,
  generationMode: "DETERMINISTIC_CONTENT_ADDRESSED_NO_WALL_CLOCK",
  inputSetHash,
  verificationRecipe: {
    writeCommand: "node validation/scripts/generate-sacs-geospatial-contract-evidence.mjs --write",
    checkCommand: "node validation/scripts/generate-sacs-geospatial-contract-evidence.mjs",
    expectedSuccessMarker: "WSGS_V021_GEOSPATIAL_CONTRACT_READY",
    embeddedExecutionClaim: false,
    exitCode: null
  },
  executionEvidence: {
    status: "RECORDED_EXTERNALLY_IN_PHASE_REPORT_AND_CI",
    phaseReportPath: "reports/sacs-geospatial-v1/N01-phase-report.md"
  },
  runtimeQualification: "NOT_RUN",
  consumerRuntimeQualification: "BLOCKED_UPSTREAM",
  productionQualified: false,
  versionSurfaces: {
    sourceAndWorkspace: {
      version: versionSurfaces.version,
      workspaceManifestCount: versionSurfaces.workspaceManifestCount,
      surfaceHash: versionSurfaces.surfaceHash,
      status: "PASS"
    },
    releaseSourceFiles: {
      status: "PASS",
      paths: versionSurfaces.releaseSurfaces.map((surface) => surface.path)
    },
    runtimeCapabilities: {
      status: "NOT_RUN",
      ownerPhase: "N04"
    },
    authoritativeHandoffMetadata: {
      status: "NOT_RUN",
      ownerPhase: "N08"
    },
    crossPhaseAcceptanceGate: "NOT_RUN"
  }
};

const contractDiffReport = {
  schemaVersion: "wsgs-v021-n01-contract-diff/1.0",
  ...commonReport,
  status: "PASS",
  legacyRelease: {
    contractVersion: "sacs-wsgs-grounding/1.0",
    lockPath: "contracts/wsgs-v0.1/contract-lock.json",
    expectedLockSha256: legacyLockSha256,
    actualLockSha256: legacy.actualLockHash,
    artifactCount: legacy.artifactCount,
    groundingResultSchemaHash: legacy.lock.artifacts["contracts/grounding-result.schema.json"],
    capabilitiesSchemaHash: legacy.lock.artifacts["contracts/capabilities-response.schema.json"],
    baselineCopyPath: "contracts/wsgs-v0.2.1-sacs-geospatial/baselines/sacs-wsgs-grounding-1.0-contract-lock.json",
    byteStable: true
  },
  additiveRelease: {
    contractVersion: "sacs-wsgs-grounding/1.1",
    wireSchemaVersion: "1.0",
    resultExtensionField: "geospatialFindings",
    resultExtensionOptional: true,
    profile: "sacs-wsgs-geospatial-findings/1.0",
    transportMode: "RESULT_EXTENSION",
    currentness: {
      mode: "DEDICATED_OPERATION",
      operation: "VALIDATE_SOURCE_CURRENTNESS"
    },
    supportedOperations: [
      "GROUND_REFERENCES",
      "COMPILE_WORLD_QUERY",
      "EXECUTE_WORLD_QUERY",
      "VALIDATE_REFERENCES",
      "RESOLVE_WORLD_SELECTION",
      "VALIDATE_SOURCE_CURRENTNESS"
    ],
    schemaHashes,
    releaseLockHash
  },
  compatibilityDecision: "ADDITIVE_RELEASE_DOES_NOT_REWRITE_1_0"
};

const schemaValidationReport = {
  schemaVersion: "wsgs-v021-n01-schema-validation/1.0",
  ...commonReport,
  status: "PASS",
  authoritativeSchemaCount: schemaNames.length,
  authoritativeSchemas: schemaHashes,
  positiveExampleCount: exampleNames.length,
  positiveExamples: exampleHashes,
  negativeCaseCount: negativeCaseIds.length,
  negativeCases: negativeCaseIds.map((caseId) => ({ caseId, status: "PASS_FAIL_CLOSED" })),
  semanticHashChecks: {
    profileSchemaHash: "PASS",
    findingSetHash: "PASS",
    sourceProductSetHash: "PASS"
  },
  additionalPropertiesPolicy: "FAIL_CLOSED_AT_ALL_PUBLISHED_OBJECT_BOUNDARIES",
  bodyAuthorityPolicy: "PRINCIPAL_SCOPE_AUTHORIZATION_TOKEN_AUTHORITY_REJECTED"
};

const sacsCompatibilityReport = {
  schemaVersion: "wsgs-v021-n01-sacs-schema-compatibility/1.0",
  ...commonReport,
  status: "SCHEMA_COMPATIBILITY_PASS_CONSUMER_BLOCKED",
  consumer: {
    repository: "zhouwen-giser/single-agent-chat-server",
    pullRequest: 17,
    headSha: sacsConsumerHead,
    worldFindingSnapshotNormalizedLfSha256: sacsWorldFindingLfHash,
    sourceProductSnapshotNormalizedLfSha256: sacsSourceProductLfHash,
    resultParserSourceNormalizedLfSha256: "sha256:d415c044e7f7273a5a38f961b811a64bc5ea4d376427bda01157b6c82164795c",
    consumerSourceNormalizedLfSha256: "sha256:64cf7340f90fe74ad1111845c9f7fe97c36ffcb08aa2756f31695756c0f65800",
    consumerFixtureSource: {
      path: "tests/world-explanation-fixtures.ts",
      normalizedLfSha256: "sha256:f9ce9a1ecc6d01a9fbb4e8843e69d0f5063c4b3fdbecc8111321d67c72bb9ffc",
      canonicalProjectionHash: sacsConsumerFixtureProjectionHash,
      projectedFindingCount: 6,
      projectedSourceProductCount: 1
    }
  },
  bidirectionalSchemaCases: {
    ...compatibility,
    wsgsToSacs: "PASS",
    sacsFixtureToWsgs: "PASS"
  },
  explicitProjectionBoundary: {
    structuredSelection: "ADAPTER_PROJECTION_REQUIRED",
    reason: "SACS internal persisted selection includes principal context; WSGS request derives authority from authentication and rejects body principal fields."
  },
  provisionalHashDisposition: "CURRENT_PR17_GIT_BLOBS_OVERRIDE_STALE_PROVISIONAL_INTAKE_HASHES",
  blockersNotResolvedByN01SchemaCompatibility: [
    "SACS_OPERATION_ENUM_MISSING_VALIDATE_SOURCE_CURRENTNESS",
    "SACS_CAPABILITY_PREFLIGHT_EXACT_SET_MISMATCH",
    "SACS_AUTHORITATIVE_HANDOFF_INTAKE_NOT_IMPLEMENTED",
    "SACS_REAL_18_CASE_RUNNER_NOT_IMPLEMENTED"
  ],
  consumerCompatible: false,
  realConsumerCasesRun: 0
};

writeOrCheck(
  join(reportRoot, "N01-contract-diff.json"),
  jsonDocument(contractDiffReport)
);
writeOrCheck(
  join(reportRoot, "N01-schema-validation.json"),
  jsonDocument(schemaValidationReport)
);
writeOrCheck(
  join(reportRoot, "N01-sacs-schema-compatibility.json"),
  jsonDocument(sacsCompatibilityReport)
);

console.log(
  `WSGS_V021_GEOSPATIAL_CONTRACT_READY schemas=${schemaNames.length} examples=${exampleNames.length} negative=${negativeCaseIds.length} sacsBidirectional=${compatibility.wsgsToSacsCaseCount + compatibility.sacsToWsgsCaseCount} legacyArtifacts=${legacy.artifactCount}`
);
