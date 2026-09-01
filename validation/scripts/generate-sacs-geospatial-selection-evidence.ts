import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  StructuredSelectionError,
  StructuredSelectionTokenCodec,
  StructuredWorldSelectionResolver,
  type PriorGroundingResult,
  type ResolveWorldSelectionRequest,
  type StructuredSelectionIdentity
} from "../../packages/structured-world-selection/src/index.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reportRoot = join(repositoryRoot, "reports", "sacs-geospatial-v1");
const write = process.argv.includes("--write");
const now = 1_800_000_000_000;
const sourceHash = `sha256:${"a".repeat(64)}`;
const resultHash = `sha256:${"b".repeat(64)}`;
const authorizationContextHash = `sha256:${"c".repeat(64)}`;
const identity: StructuredSelectionIdentity = {
  servicePrincipalId: "sacs-service",
  actorId: "actor-1",
  dataScope: "scope-gdps",
  authorizationContextHash
};
const request: ResolveWorldSelectionRequest = {
  schemaVersion: "wsgs-structured-selection-request/1.0",
  priorGroundingId: "grounding-1",
  priorResultHash: resultHash,
  findingId: "finding-1",
  featureId: "feature-1",
  selectionRevision: 1,
  sourceHash
};

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function canonicalHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function document(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeOrCheck(path: string, content: string): void {
  if (write) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return;
  }
  if (!existsSync(path) || readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== content) {
    throw new Error(`N05_GENERATED_ARTIFACT_DRIFT:${relative(repositoryRoot, path)}`);
  }
}

function prior(feature: Record<string, unknown>): PriorGroundingResult {
  return {
    groundingId: "grounding-1",
    resultHash,
    geospatialFindings: {
      findings: [{
        findingId: "finding-1",
        sourceProductIds: ["source-1"],
        features: [{ featureId: "feature-1", ...feature }]
      }],
      sourceProducts: [{ sourceProductId: "source-1", contentHash: sourceHash }]
    }
  };
}

function resolver(at = now, activeKeyId = "k2"): StructuredWorldSelectionResolver {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  return new StructuredWorldSelectionResolver(new StructuredSelectionTokenCodec({
    activeKeyId,
    keys: [
      { keyId: "k1", key: Uint8Array.from(key, (value) => value ^ 0x55) },
      { keyId: "k2", key }
    ],
    ttlMs: 300_000,
    now: () => at,
    randomBytes: (size) => new Uint8Array(size).fill(activeKeyId === "k1" ? 3 : 7)
  }), () => at);
}

function expectedError(caseId: string, expected: string, run: () => unknown): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    if (error instanceof StructuredSelectionError && error.code === expected) {
      return { caseId, expectedCode: expected, status: "PASS_FAIL_CLOSED" };
    }
    throw error;
  }
  throw new Error(`${caseId}: expected ${expected}`);
}

const active = resolver();
const referenceResult = active.resolve({
  identity,
  request,
  priorResult: prior({
    referenceKey: {
      namespace: "gowm",
      kind: "WORLD_OBJECT",
      id: `wrf_${"d".repeat(32)}`,
      version: "1.0.0"
    }
  })
});
if (!referenceResult.referenceKey || referenceResult.upstreamSelectionToken !== undefined) {
  throw new Error("N05_REFERENCE_KEY_XOR_FAILED");
}
const tokenResult = active.resolve({ identity, request, priorResult: prior({ geometry: { type: "Point" } }) });
if (!tokenResult.upstreamSelectionToken || tokenResult.referenceKey !== undefined) {
  throw new Error("N05_TOKEN_XOR_FAILED");
}
const token = tokenResult.upstreamSelectionToken;
if (token.includes("grounding-1") || token.includes("sacs-service") || token.includes("scope-gdps")) {
  throw new Error("N05_TOKEN_NOT_OPAQUE");
}
const verified = active.verify({ identity, token, expected: request });
if (verified.selectionId !== tokenResult.selectionId) throw new Error("N05_SELECTION_BINDING_DRIFT");

const negativeCases = [
  expectedError("N05-N01", "SELECTION_RESULT_HASH_MISMATCH", () => active.resolve({
    identity,
    request: { ...request, priorResultHash: `sha256:${"e".repeat(64)}` },
    priorResult: prior({ geometry: {} })
  })),
  expectedError("N05-N02", "SELECTION_NOT_FOUND", () => active.resolve({
    identity,
    request: { ...request, featureId: "foreign" },
    priorResult: prior({ geometry: {} })
  })),
  expectedError("N05-N03", "SELECTION_SOURCE_HASH_MISMATCH", () => active.resolve({
    identity,
    request: { ...request, sourceHash: `sha256:${"f".repeat(64)}` },
    priorResult: prior({ geometry: {} })
  })),
  expectedError("N05-N04", "SELECTION_REVISION_CONFLICT", () => active.resolve({
    identity,
    request,
    priorResult: prior({ geometry: {} }),
    latestSelectionRevision: 1
  })),
  expectedError("N05-N05", "SELECTION_REFERENCE_STALE", () => active.resolve({
    identity,
    request,
    priorResult: prior({ geometry: {} }),
    currentSourceHash: `sha256:${"0".repeat(64)}`
  })),
  expectedError("N05-N06", "SELECTION_TOKEN_INVALID", () => active.verify({
    identity,
    token: `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`
  })),
  expectedError("N05-N07", "SELECTION_SCOPE_MISMATCH", () => active.verify({
    identity: { ...identity, dataScope: "foreign" },
    token
  })),
  expectedError("N05-N08", "SELECTION_TOKEN_EXPIRED", () => resolver(now + 300_001).verify({ identity, token })),
  expectedError("N05-N09", "SELECTION_REFERENCE_STALE", () => active.verify({
    identity,
    token,
    currentSourceHash: `sha256:${"0".repeat(64)}`
  }))
];

const restarted = resolver();
if (restarted.verify({ identity, token }).selectionId !== tokenResult.selectionId) {
  throw new Error("N05_RESTART_VERIFICATION_FAILED");
}
const oldKeyIssuer = resolver(now, "k1");
const oldToken = oldKeyIssuer.resolve({ identity, request, priorResult: prior({ geometry: {} }) }).upstreamSelectionToken;
if (!oldToken || active.verify({ identity, token: oldToken }).selectionId !== tokenResult.selectionId) {
  throw new Error("N05_KEY_ROTATION_VERIFICATION_FAILED");
}

const sourcePaths = [
  "packages/structured-world-selection/src/index.ts",
  "packages/structured-world-selection/src/index.test.ts",
  "services/grounding-api/src/server.ts",
  "services/grounding-api/src/production.ts",
  "contracts/wsgs-v0.2.1-sacs-geospatial/structured-selection-request.schema.json",
  "contracts/wsgs-v0.2.1-sacs-geospatial/structured-selection-result.schema.json"
];
const sourceHashes = Object.fromEntries(sourcePaths.map((path) => [
  path,
  sha256(readFileSync(join(repositoryRoot, path)))
]));
const inputSetHash = canonicalHash(sourceHashes);
const common = {
  phase: "N05",
  generator: { name: "generate-sacs-geospatial-selection-evidence", version: "1.0.0" },
  generationMode: "DETERMINISTIC_TEST_VECTOR_EXECUTION_NO_WALL_CLOCK",
  inputSetHash,
  sourceHashes,
  runtimeQualification: "NOT_RUN",
  postgresQualification: "NOT_RUN_N07_OWNER",
  consumerRuntimeQualification: "NOT_RUN_N09_OWNER",
  productionQualified: false
};

writeOrCheck(join(reportRoot, "N05-selection-contract.json"), document({
  schemaVersion: "wsgs-v021-n05-selection-contract/1.0",
  ...common,
  status: "PASS",
  operation: "RESOLVE_WORLD_SELECTION",
  apiRoute: "POST /v1/world-selections:resolve",
  authoritySource: "AUTHENTICATED_CONTEXT_ONLY",
  selectionKinds: ["REFERENCE_KEY", "OPAQUE_ENCRYPTED_TOKEN"],
  xorProjection: "PASS",
  bindingChecks: [
    "priorGroundingId", "priorResultHash", "findingId", "featureId",
    "selectionRevision", "sourceHash", "servicePrincipalId", "actorId", "dataScope",
    "authorizationContextHash"
  ]
}));

writeOrCheck(join(reportRoot, "N05-token-security.json"), document({
  schemaVersion: "wsgs-v021-n05-token-security/1.0",
  ...common,
  status: "PASS",
  algorithm: "AES-256-GCM",
  tokenClaimsOpaque: true,
  activeKeyId: "TEST_VECTOR_K2",
  retainedVerificationKeyCount: 2,
  rawTokenPersistedInEvidence: false,
  tokenSha256: sha256(token),
  negativeCases
}));

writeOrCheck(join(reportRoot, "N05-replay.json"), document({
  schemaVersion: "wsgs-v021-n05-replay/1.0",
  ...common,
  status: "PASS_SOURCE_AND_UNIT",
  selectionBindingStable: true,
  sameTokenAfterProcessRestart: "PASS",
  retainedOldKeyAfterRotation: "PASS",
  expiredToken: "PASS_FAIL_CLOSED",
  changedSource: "PASS_FAIL_CLOSED",
  durableReceiptReplay: "NOT_RUN_N07_OWNER"
}));

console.log(`WSGS_V021_STRUCTURED_SELECTION_READY cases=${negativeCases.length + 4} inputSetHash=${inputSetHash}`);
