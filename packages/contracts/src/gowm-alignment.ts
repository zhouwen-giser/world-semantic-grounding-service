import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK_RELATIVE_PATH =
  "contracts/upstream/gowm-runtime-contract-alignment-lock-v1.json" as const;

export type GowmSha256Digest = `sha256:${string}`;
export type GowmSha512Integrity = `sha512-${string}`;

export interface GowmAlignmentTaskSource {
  readonly wsgsRepository: string;
  readonly wsgsCommit: string;
  readonly wsgsVersion: string;
  readonly targetWsgsVersion: string;
  readonly northboundContractVersion: string;
}

export interface GowmAlignmentRequiredTuple {
  readonly gowmRuntimeVersion: string;
  readonly gatewayContractVersion: string;
  readonly gatewayConsumerPackageVersion: string;
  readonly runtimeAndContractVersionsMustRemainIndependent: boolean;
  readonly runtimeVersionMustNotBeCopiedIntoContractVersion: boolean;
}

export interface GowmAlignmentRuntime {
  readonly repository: string;
  readonly sourceCommit: string;
  readonly softwareVersion: string;
  readonly versionAuthority: string;
  readonly knownNonAuthoritativeVersionFile: {
    readonly path: string;
    readonly observedValueAtSourceCommit: string;
    readonly mustNotBeUsedAsRuntimeVersionAuthority: boolean;
  };
}

export interface GowmAlignmentGatewayContract {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly gatewayContractVersion: string;
  readonly packageVersionAuthority: string;
  readonly gatewayContractVersionAuthority: string;
  readonly consumerLogicalIntegrity: GowmSha512Integrity;
  readonly contractCatalogRevision: GowmSha256Digest;
  readonly semanticCatalogHash: GowmSha256Digest;
  readonly availabilityContractHash: GowmSha256Digest;
  readonly snapshotContractHash: GowmSha256Digest;
  readonly delegationContractHash: GowmSha256Digest;
  readonly southboundLockFileSha256: GowmSha256Digest;
}

export interface GowmAlignmentCompatibilityPolicy {
  readonly classification: string;
  readonly wireContractVersionChanged: boolean;
  readonly northboundContractChanged: boolean;
  readonly runtimeVersionMustNotDetermineGatewayContractVersion: boolean;
  readonly allowOnlyDeclaredSemanticProfileMigrations: boolean;
  readonly requireCriticalInputOutputSchemaStability: boolean;
  readonly requireOperationVersionStability: boolean;
  readonly requirePermissionAndSnapshotPolicyStability: boolean;
  readonly singleUpstreamAuthorityRequired: boolean;
  readonly failClosedOnUnexpectedWireDrift: boolean;
  readonly failClosed: boolean;
}

export interface GowmAlignmentCriticalOperationFingerprint {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly inputSchemaHash: GowmSha256Digest;
  readonly outputSchemaHash: GowmSha256Digest;
  readonly semanticProfileHash: GowmSha256Digest;
  readonly maturity: "STABLE" | "PREVIEW";
  readonly requiredPermissions: readonly string[];
  readonly snapshotSupport: "NONE" | "BEST_EFFORT" | "CONSISTENT_AT_START" | "PINNED";
}

export interface GowmAlignmentDeclaredSemanticProfileMigration {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly fromSemanticProfileHash: GowmSha256Digest;
  readonly toSemanticProfileHash: GowmSha256Digest;
  readonly classification: string;
}

export interface GowmRuntimeContractAlignmentLock {
  readonly $schema: string;
  readonly schemaVersion: "1.0";
  readonly alignmentId: string;
  readonly status: "LOCKED";
  readonly taskGeneratedAgainst: GowmAlignmentTaskSource;
  readonly requiredTuple: GowmAlignmentRequiredTuple;
  readonly gowmRuntime: GowmAlignmentRuntime;
  readonly gatewayContract: GowmAlignmentGatewayContract;
  readonly compatibilityPolicy: GowmAlignmentCompatibilityPolicy;
  readonly criticalOperationFingerprints: readonly GowmAlignmentCriticalOperationFingerprint[];
  readonly declaredSemanticProfileMigrations: readonly GowmAlignmentDeclaredSemanticProfileMigration[];
  readonly requiredInvariantIds: readonly string[];
}

export interface LoadGowmRuntimeContractAlignmentLockOptions {
  readonly lockPath?: string;
}

export class GowmRuntimeContractAlignmentLockError extends Error {
  public constructor(
    readonly code: "ALIGNMENT_LOCK_UNREADABLE" | "ALIGNMENT_LOCK_INVALID",
    message: string = code
  ) {
    super(message);
    this.name = "GowmRuntimeContractAlignmentLockError";
  }
}

const defaultLockPath = fileURLToPath(new URL(
  "../../../contracts/upstream/gowm-runtime-contract-alignment-lock-v1.json",
  import.meta.url
));
const commitPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const sha512Pattern = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

function fail(message: string): never {
  throw new GowmRuntimeContractAlignmentLockError("ALIGNMENT_LOCK_INVALID", message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${path} has an unexpected field set`);
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) return fail(`${path} must be a non-empty string`);
  return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) return fail(`${path} must be ${expected}`);
  return expected;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(`${path} must be a boolean`);
  return value;
}

function commit(value: unknown, path: string): string {
  const result = text(value, path);
  if (!commitPattern.test(result)) return fail(`${path} must be a lowercase 40-character Git SHA`);
  return result;
}

function sha256(value: unknown, path: string): GowmSha256Digest {
  const result = text(value, path);
  if (!sha256Pattern.test(result)) return fail(`${path} must be a prefixed lowercase SHA-256 digest`);
  return result as GowmSha256Digest;
}

function sha512(value: unknown, path: string): GowmSha512Integrity {
  const result = text(value, path);
  if (!sha512Pattern.test(result)) return fail(`${path} must be a SHA-512 SRI value`);
  return result as GowmSha512Integrity;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) return fail(`${path} must be a non-empty array`);
  const result = value.map((entry, index) => text(entry, `${path}[${index}]`));
  if (new Set(result).size !== result.length) return fail(`${path} must not contain duplicates`);
  return result;
}

function taskSource(value: unknown): GowmAlignmentTaskSource {
  const record = object(value, "taskGeneratedAgainst");
  exactKeys(record, [
    "wsgsRepository",
    "wsgsCommit",
    "wsgsVersion",
    "targetWsgsVersion",
    "northboundContractVersion"
  ], "taskGeneratedAgainst");
  return {
    wsgsRepository: text(record["wsgsRepository"], "taskGeneratedAgainst.wsgsRepository"),
    wsgsCommit: commit(record["wsgsCommit"], "taskGeneratedAgainst.wsgsCommit"),
    wsgsVersion: text(record["wsgsVersion"], "taskGeneratedAgainst.wsgsVersion"),
    targetWsgsVersion: text(record["targetWsgsVersion"], "taskGeneratedAgainst.targetWsgsVersion"),
    northboundContractVersion: text(
      record["northboundContractVersion"],
      "taskGeneratedAgainst.northboundContractVersion"
    )
  };
}

function requiredTuple(value: unknown): GowmAlignmentRequiredTuple {
  const record = object(value, "requiredTuple");
  exactKeys(record, [
    "gowmRuntimeVersion",
    "gatewayContractVersion",
    "gatewayConsumerPackageVersion",
    "runtimeAndContractVersionsMustRemainIndependent",
    "runtimeVersionMustNotBeCopiedIntoContractVersion"
  ], "requiredTuple");
  return {
    gowmRuntimeVersion: text(record["gowmRuntimeVersion"], "requiredTuple.gowmRuntimeVersion"),
    gatewayContractVersion: text(record["gatewayContractVersion"], "requiredTuple.gatewayContractVersion"),
    gatewayConsumerPackageVersion: text(
      record["gatewayConsumerPackageVersion"],
      "requiredTuple.gatewayConsumerPackageVersion"
    ),
    runtimeAndContractVersionsMustRemainIndependent: bool(
      record["runtimeAndContractVersionsMustRemainIndependent"],
      "requiredTuple.runtimeAndContractVersionsMustRemainIndependent"
    ),
    runtimeVersionMustNotBeCopiedIntoContractVersion: bool(
      record["runtimeVersionMustNotBeCopiedIntoContractVersion"],
      "requiredTuple.runtimeVersionMustNotBeCopiedIntoContractVersion"
    )
  };
}

function runtime(value: unknown): GowmAlignmentRuntime {
  const record = object(value, "gowmRuntime");
  exactKeys(record, [
    "repository",
    "sourceCommit",
    "softwareVersion",
    "versionAuthority",
    "knownNonAuthoritativeVersionFile"
  ], "gowmRuntime");
  const known = object(
    record["knownNonAuthoritativeVersionFile"],
    "gowmRuntime.knownNonAuthoritativeVersionFile"
  );
  exactKeys(known, [
    "path",
    "observedValueAtSourceCommit",
    "mustNotBeUsedAsRuntimeVersionAuthority"
  ], "gowmRuntime.knownNonAuthoritativeVersionFile");
  return {
    repository: text(record["repository"], "gowmRuntime.repository"),
    sourceCommit: commit(record["sourceCommit"], "gowmRuntime.sourceCommit"),
    softwareVersion: text(record["softwareVersion"], "gowmRuntime.softwareVersion"),
    versionAuthority: text(record["versionAuthority"], "gowmRuntime.versionAuthority"),
    knownNonAuthoritativeVersionFile: {
      path: text(known["path"], "gowmRuntime.knownNonAuthoritativeVersionFile.path"),
      observedValueAtSourceCommit: text(
        known["observedValueAtSourceCommit"],
        "gowmRuntime.knownNonAuthoritativeVersionFile.observedValueAtSourceCommit"
      ),
      mustNotBeUsedAsRuntimeVersionAuthority: bool(
        known["mustNotBeUsedAsRuntimeVersionAuthority"],
        "gowmRuntime.knownNonAuthoritativeVersionFile.mustNotBeUsedAsRuntimeVersionAuthority"
      )
    }
  };
}

function gatewayContract(value: unknown): GowmAlignmentGatewayContract {
  const record = object(value, "gatewayContract");
  exactKeys(record, [
    "packageName",
    "packageVersion",
    "gatewayContractVersion",
    "packageVersionAuthority",
    "gatewayContractVersionAuthority",
    "consumerLogicalIntegrity",
    "contractCatalogRevision",
    "semanticCatalogHash",
    "availabilityContractHash",
    "snapshotContractHash",
    "delegationContractHash",
    "southboundLockFileSha256"
  ], "gatewayContract");
  return {
    packageName: text(record["packageName"], "gatewayContract.packageName"),
    packageVersion: text(record["packageVersion"], "gatewayContract.packageVersion"),
    gatewayContractVersion: text(record["gatewayContractVersion"], "gatewayContract.gatewayContractVersion"),
    packageVersionAuthority: text(
      record["packageVersionAuthority"],
      "gatewayContract.packageVersionAuthority"
    ),
    gatewayContractVersionAuthority: text(
      record["gatewayContractVersionAuthority"],
      "gatewayContract.gatewayContractVersionAuthority"
    ),
    consumerLogicalIntegrity: sha512(
      record["consumerLogicalIntegrity"],
      "gatewayContract.consumerLogicalIntegrity"
    ),
    contractCatalogRevision: sha256(
      record["contractCatalogRevision"],
      "gatewayContract.contractCatalogRevision"
    ),
    semanticCatalogHash: sha256(record["semanticCatalogHash"], "gatewayContract.semanticCatalogHash"),
    availabilityContractHash: sha256(
      record["availabilityContractHash"],
      "gatewayContract.availabilityContractHash"
    ),
    snapshotContractHash: sha256(record["snapshotContractHash"], "gatewayContract.snapshotContractHash"),
    delegationContractHash: sha256(
      record["delegationContractHash"],
      "gatewayContract.delegationContractHash"
    ),
    southboundLockFileSha256: sha256(
      record["southboundLockFileSha256"],
      "gatewayContract.southboundLockFileSha256"
    )
  };
}

function compatibilityPolicy(value: unknown): GowmAlignmentCompatibilityPolicy {
  const record = object(value, "compatibilityPolicy");
  exactKeys(record, [
    "classification",
    "wireContractVersionChanged",
    "northboundContractChanged",
    "runtimeVersionMustNotDetermineGatewayContractVersion",
    "allowOnlyDeclaredSemanticProfileMigrations",
    "requireCriticalInputOutputSchemaStability",
    "requireOperationVersionStability",
    "requirePermissionAndSnapshotPolicyStability",
    "singleUpstreamAuthorityRequired",
    "failClosedOnUnexpectedWireDrift",
    "failClosed"
  ], "compatibilityPolicy");
  return {
    classification: text(record["classification"], "compatibilityPolicy.classification"),
    wireContractVersionChanged: bool(
      record["wireContractVersionChanged"],
      "compatibilityPolicy.wireContractVersionChanged"
    ),
    northboundContractChanged: bool(
      record["northboundContractChanged"],
      "compatibilityPolicy.northboundContractChanged"
    ),
    runtimeVersionMustNotDetermineGatewayContractVersion: bool(
      record["runtimeVersionMustNotDetermineGatewayContractVersion"],
      "compatibilityPolicy.runtimeVersionMustNotDetermineGatewayContractVersion"
    ),
    allowOnlyDeclaredSemanticProfileMigrations: bool(
      record["allowOnlyDeclaredSemanticProfileMigrations"],
      "compatibilityPolicy.allowOnlyDeclaredSemanticProfileMigrations"
    ),
    requireCriticalInputOutputSchemaStability: bool(
      record["requireCriticalInputOutputSchemaStability"],
      "compatibilityPolicy.requireCriticalInputOutputSchemaStability"
    ),
    requireOperationVersionStability: bool(
      record["requireOperationVersionStability"],
      "compatibilityPolicy.requireOperationVersionStability"
    ),
    requirePermissionAndSnapshotPolicyStability: bool(
      record["requirePermissionAndSnapshotPolicyStability"],
      "compatibilityPolicy.requirePermissionAndSnapshotPolicyStability"
    ),
    singleUpstreamAuthorityRequired: bool(
      record["singleUpstreamAuthorityRequired"],
      "compatibilityPolicy.singleUpstreamAuthorityRequired"
    ),
    failClosedOnUnexpectedWireDrift: bool(
      record["failClosedOnUnexpectedWireDrift"],
      "compatibilityPolicy.failClosedOnUnexpectedWireDrift"
    ),
    failClosed: bool(record["failClosed"], "compatibilityPolicy.failClosed")
  };
}

function criticalOperation(value: unknown, index: number): GowmAlignmentCriticalOperationFingerprint {
  const path = `criticalOperationFingerprints[${index}]`;
  const record = object(value, path);
  exactKeys(record, [
    "operationId",
    "operationVersion",
    "inputSchemaHash",
    "outputSchemaHash",
    "semanticProfileHash",
    "maturity",
    "requiredPermissions",
    "snapshotSupport"
  ], path);
  const maturity = record["maturity"];
  if (maturity !== "STABLE" && maturity !== "PREVIEW") return fail(`${path}.maturity is invalid`);
  const snapshotSupport = record["snapshotSupport"];
  if (!["NONE", "BEST_EFFORT", "CONSISTENT_AT_START", "PINNED"].includes(String(snapshotSupport))) {
    return fail(`${path}.snapshotSupport is invalid`);
  }
  return {
    operationId: text(record["operationId"], `${path}.operationId`),
    operationVersion: text(record["operationVersion"], `${path}.operationVersion`),
    inputSchemaHash: sha256(record["inputSchemaHash"], `${path}.inputSchemaHash`),
    outputSchemaHash: sha256(record["outputSchemaHash"], `${path}.outputSchemaHash`),
    semanticProfileHash: sha256(record["semanticProfileHash"], `${path}.semanticProfileHash`),
    maturity,
    requiredPermissions: stringArray(record["requiredPermissions"], `${path}.requiredPermissions`),
    snapshotSupport: snapshotSupport as GowmAlignmentCriticalOperationFingerprint["snapshotSupport"]
  };
}

function declaredMigration(
  value: unknown,
  index: number
): GowmAlignmentDeclaredSemanticProfileMigration {
  const path = `declaredSemanticProfileMigrations[${index}]`;
  const record = object(value, path);
  exactKeys(record, [
    "operationId",
    "operationVersion",
    "fromSemanticProfileHash",
    "toSemanticProfileHash",
    "classification"
  ], path);
  return {
    operationId: text(record["operationId"], `${path}.operationId`),
    operationVersion: text(record["operationVersion"], `${path}.operationVersion`),
    fromSemanticProfileHash: sha256(
      record["fromSemanticProfileHash"],
      `${path}.fromSemanticProfileHash`
    ),
    toSemanticProfileHash: sha256(record["toSemanticProfileHash"], `${path}.toSemanticProfileHash`),
    classification: text(record["classification"], `${path}.classification`)
  };
}

function parseAlignmentLock(value: unknown): GowmRuntimeContractAlignmentLock {
  const record = object(value, "alignmentLock");
  exactKeys(record, [
    "$schema",
    "schemaVersion",
    "alignmentId",
    "status",
    "taskGeneratedAgainst",
    "requiredTuple",
    "gowmRuntime",
    "gatewayContract",
    "compatibilityPolicy",
    "criticalOperationFingerprints",
    "declaredSemanticProfileMigrations",
    "requiredInvariantIds"
  ], "alignmentLock");
  if (!Array.isArray(record["criticalOperationFingerprints"]) ||
      record["criticalOperationFingerprints"].length === 0) {
    return fail("criticalOperationFingerprints must be a non-empty array");
  }
  if (!Array.isArray(record["declaredSemanticProfileMigrations"])) {
    return fail("declaredSemanticProfileMigrations must be an array");
  }
  const result: GowmRuntimeContractAlignmentLock = {
    $schema: text(record["$schema"], "alignmentLock.$schema"),
    schemaVersion: literal(record["schemaVersion"], "1.0", "alignmentLock.schemaVersion"),
    alignmentId: text(record["alignmentId"], "alignmentLock.alignmentId"),
    status: literal(record["status"], "LOCKED", "alignmentLock.status"),
    taskGeneratedAgainst: taskSource(record["taskGeneratedAgainst"]),
    requiredTuple: requiredTuple(record["requiredTuple"]),
    gowmRuntime: runtime(record["gowmRuntime"]),
    gatewayContract: gatewayContract(record["gatewayContract"]),
    compatibilityPolicy: compatibilityPolicy(record["compatibilityPolicy"]),
    criticalOperationFingerprints: record["criticalOperationFingerprints"]
      .map((entry, index) => criticalOperation(entry, index)),
    declaredSemanticProfileMigrations: record["declaredSemanticProfileMigrations"]
      .map((entry, index) => declaredMigration(entry, index)),
    requiredInvariantIds: stringArray(record["requiredInvariantIds"], "requiredInvariantIds")
  };
  if (result.requiredTuple.gowmRuntimeVersion !== result.gowmRuntime.softwareVersion) {
    return fail("requiredTuple.gowmRuntimeVersion must match gowmRuntime.softwareVersion");
  }
  if (result.requiredTuple.gatewayContractVersion !== result.gatewayContract.gatewayContractVersion) {
    return fail("requiredTuple.gatewayContractVersion must match gatewayContract.gatewayContractVersion");
  }
  if (result.requiredTuple.gatewayConsumerPackageVersion !== result.gatewayContract.packageVersion) {
    return fail("requiredTuple.gatewayConsumerPackageVersion must match gatewayContract.packageVersion");
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export function loadGowmRuntimeContractAlignmentLock(
  options: LoadGowmRuntimeContractAlignmentLockOptions = {}
): GowmRuntimeContractAlignmentLock {
  const path = options.lockPath ?? defaultLockPath;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GowmRuntimeContractAlignmentLockError(
      "ALIGNMENT_LOCK_UNREADABLE",
      `Cannot read GOWM runtime/contract alignment lock: ${detail}`
    );
  }
  return deepFreeze(parseAlignmentLock(parsed));
}

export const GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK =
  loadGowmRuntimeContractAlignmentLock();
export const GOWM_RUNTIME_SOURCE_COMMIT =
  GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK.gowmRuntime.sourceCommit;
export const GOWM_RUNTIME_VERSION =
  GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK.gowmRuntime.softwareVersion;
export const GOWM_GATEWAY_CONTRACT_VERSION =
  GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK.gatewayContract.gatewayContractVersion;
export const GOWM_CONSUMER_PACKAGE_NAME =
  GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK.gatewayContract.packageName;
export const GOWM_CONSUMER_PACKAGE_VERSION =
  GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK.gatewayContract.packageVersion;
