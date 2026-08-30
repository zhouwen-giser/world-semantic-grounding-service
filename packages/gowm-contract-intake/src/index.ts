import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

export const GOWM_INTAKE_VERSION = "gowm-contract-intake/2.0" as const;
export const GOWM_SOURCE_REPOSITORY = "zhouwen-giser/geospatial-operational-world-model" as const;
export const GOWM_RUNTIME_SOURCE_COMMIT = "f2894d86eeca121f9cea76c70797ece3b091d51f" as const;
export const GOWM_RUNTIME_VERSION = "0.6.4" as const;
export const GOWM_GATEWAY_CONTRACT_VERSION = "0.6.3" as const;
export const GOWM_CONSUMER_PACKAGE_NAME = "@gowm/world-gateway-contracts" as const;
export const GOWM_CONSUMER_PACKAGE_VERSION = "0.6.3" as const;
export const GOWM_CONSUMER_LOGICAL_INTEGRITY =
  "sha512-KekpsVw943+iWwWcKepSxl408uBqH6oQ/ZzHcsrQrq2EjP+r2zYtljOfFekP6Vksxx1oSbE66rqaHE2rUGv6xw==" as const;
export const GOWM_CONSUMER_TARBALL_BYTES = 52_872 as const;
export const GOWM_CONSUMER_TARBALL_SHA256 =
  "866b310ae5d28a49d59683975c858c0da1d46c0565168a8faba7e0c200d9c887" as const;
export const GOWM_CONSUMER_TARBALL_SHA512 =
  "sha512-5RvJ9EK3jvTXR/Gzr27E5tqB60+WJbD/WwTUtcPtBBH/c0Cq9ggWArTeFz7515MP+SagE418zXs/FUPS/gcdAA==" as const;
export const GOWM_CONTRACT_CATALOG_REVISION =
  "sha256:efd0395dbd05c884c781f964b22147efcb38c4cef91704597706ec4b8332075a" as const;
export const GOWM_BINDING_REVISION =
  "sha256:1d59337bcbd8cb8dd76d0241d08b8c7618f61daa6e9c43d25db45c11994f1394" as const;
export const GOWM_SEMANTIC_CATALOG_HASH =
  "sha256:418fc328861e846801c6e8109bf6d48b876c7814c650a391b84076f71e588b61" as const;
export const GOWM_AVAILABILITY_CONTRACT_HASH =
  "sha256:66d6cfe2679d6bdd0cf6f22cb7153d1f5f4c934ebc286f6bac33ab6bd7eb4036" as const;
export const GOWM_SNAPSHOT_CONTRACT_HASH =
  "sha256:350044225667ce00c2850e9a9d7c86762fc2e042793b6a8666c724c763135ca0" as const;
export const GOWM_DELEGATION_CONTRACT_HASH =
  "sha256:6edf49002dc75e6701c9c56b8795539b3512884d31b66f7f12f122abdee9344b" as const;
export const GOWM_SOUTHBOUND_LOCK_RAW_SHA256 =
  "765714690fc2192138f925526cc6bf0215c2481fa234c566756c26b891649686" as const;
/** @deprecated The exact Kek materialization is raw-byte pinned; use GOWM_SOUTHBOUND_LOCK_RAW_SHA256. */
export const GOWM_SOUTHBOUND_LOCK_LF_SHA256 = GOWM_SOUTHBOUND_LOCK_RAW_SHA256;
export const GOWM_MATERIALIZATION_TREE_SHA256 =
  "sha256:0c6b4e70a8d345135657b20e4d5ed22e81b364bcdb7774ba9238de091cdcd680" as const;

const WSGS_SOURCE_REPOSITORY = "zhouwen-giser/world-semantic-grounding-service" as const;
const WSGS_SOURCE_COMMIT = "c2a71a0f455c728ae45d70067f223e1450cfa427" as const;
const WSGS_SOURCE_VERSION = "0.2.0" as const;
const NORTHBOUND_CONTRACT_VERSION = "sacs-wsgs-grounding/1.0" as const;
const TARGET_VERSION = "0.2.1" as const;
const ALIGNMENT_LOCK_FILE_NAME = "gowm-runtime-contract-alignment-lock-v1.json" as const;
const ALIGNMENT_LOCK_SCHEMA_FILE_NAME = "gowm-runtime-contract-alignment-lock-v1.schema.json" as const;
const TARBALL_FILE_NAME = "gowm-world-gateway-contracts-0.6.3.tgz" as const;
const LOCK_RELATIVE_PATH = "locks/wsgs-southbound-operation-lock-v2.json" as const;
const MANIFEST_FILE_COUNT = 62 as const;
const PACKAGE_FILE_COUNT = 64 as const;
const RAW_CRLF_PACKAGE_FILE_COUNT = 58 as const;
const DEFAULT_OPERATION_COUNT = 31 as const;
const PREVIEW_OPERATION_COUNT = 89 as const;
const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export interface IntakeCheck {
  id: string;
  status: "PASS";
  actual: string;
  expected: string;
}

export interface ContractIntakeReport {
  schemaVersion: "1.0";
  sourceCommit: typeof GOWM_RUNTIME_SOURCE_COMMIT;
  packageIntegrity: typeof GOWM_CONSUMER_LOGICAL_INTEGRITY;
  checks: IntakeCheck[];
  status: "PASS";
}

export interface GowmContractIntakeSummary {
  status: "PASS";
  sourceCommit: typeof GOWM_RUNTIME_SOURCE_COMMIT;
  runtimeVersion: typeof GOWM_RUNTIME_VERSION;
  gatewayContractVersion: typeof GOWM_GATEWAY_CONTRACT_VERSION;
  packageName: typeof GOWM_CONSUMER_PACKAGE_NAME;
  packageVersion: typeof GOWM_CONSUMER_PACKAGE_VERSION;
  packageIntegrity: typeof GOWM_CONSUMER_LOGICAL_INTEGRITY;
  tarballBytes: typeof GOWM_CONSUMER_TARBALL_BYTES;
  tarballSha256: typeof GOWM_CONSUMER_TARBALL_SHA256;
  tarballSha512: typeof GOWM_CONSUMER_TARBALL_SHA512;
  manifestFileCount: typeof MANIFEST_FILE_COUNT;
  manifestRawByteFileCount: typeof MANIFEST_FILE_COUNT;
  rawCrlfPackageFileCount: typeof RAW_CRLF_PACKAGE_FILE_COUNT;
  archiveFileCount: typeof PACKAGE_FILE_COUNT;
  extractedFileCount: typeof PACKAGE_FILE_COUNT;
  materializationTreeSha256: typeof GOWM_MATERIALIZATION_TREE_SHA256;
  defaultOperationCount: typeof DEFAULT_OPERATION_COUNT;
  previewOperationCount: typeof PREVIEW_OPERATION_COUNT;
  checks: IntakeCheck[];
}

export interface VerifyGowmContractIntakeOptions {
  repositoryRoot?: string;
  intakeRoot?: string;
  verifyRecordedEvidence?: boolean;
}

interface ManifestFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

interface ConsumerManifest {
  schemaVersion: string;
  packageName: string;
  packageVersion: string;
  contractCatalogRevision: string;
  semanticCatalogHash: string;
  files: ManifestFileRecord[];
  packageIntegrity: string;
}

interface SouthboundOperation {
  operationId: string;
  operationVersion: string;
  maturity: "STABLE" | "PREVIEW";
}

interface SouthboundOperationLock {
  schemaVersion: string;
  gatewayContractVersion: string;
  consumerContractPackage: { name: string; version: string; integrity: string };
  contractCatalogRevision: string;
  semanticCatalogHash: string;
  availabilityContractHash: string;
  snapshotContractHash: string;
  delegationContractHash: string;
  defaultOperations: SouthboundOperation[];
  previewOperations: SouthboundOperation[];
}

interface GowmRuntimeContractAlignmentLock {
  schemaVersion: "1.0";
  status: "LOCKED";
  taskGeneratedAgainst: {
    wsgsRepository: string;
    wsgsCommit: string;
    wsgsVersion: string;
    targetWsgsVersion: string;
    northboundContractVersion: string;
  };
  requiredTuple: {
    gowmRuntimeVersion: string;
    gatewayContractVersion: string;
    gatewayConsumerPackageVersion: string;
    runtimeAndContractVersionsMustRemainIndependent: boolean;
    runtimeVersionMustNotBeCopiedIntoContractVersion: boolean;
  };
  gowmRuntime: {
    repository: string;
    sourceCommit: string;
    softwareVersion: string;
  };
  gatewayContract: {
    packageName: string;
    packageVersion: string;
    gatewayContractVersion: string;
    consumerLogicalIntegrity: string;
    contractCatalogRevision: string;
    semanticCatalogHash: string;
    availabilityContractHash: string;
    snapshotContractHash: string;
    delegationContractHash: string;
    southboundLockFileSha256: string;
  };
}

interface PackageFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

interface PackageIntegrityEvidence {
  schemaVersion: "1.0";
  logicalPackageIntegrity: typeof GOWM_CONSUMER_LOGICAL_INTEGRITY;
  logicalIntegrityAlgorithm: "SHA512_BASE64_OF_CANONICAL_PRE_LOCK_FILE_RECORDS";
  tarball: {
    path: typeof TARBALL_FILE_NAME;
    bytes: typeof GOWM_CONSUMER_TARBALL_BYTES;
    sha256: typeof GOWM_CONSUMER_TARBALL_SHA256;
    sha512: typeof GOWM_CONSUMER_TARBALL_SHA512;
  };
  materialization: {
    archiveFileCount: typeof PACKAGE_FILE_COUNT;
    extractedFileCount: typeof PACKAGE_FILE_COUNT;
    rawCrlfPackageFileCount: typeof RAW_CRLF_PACKAGE_FILE_COUNT;
    treeSha256: typeof GOWM_MATERIALIZATION_TREE_SHA256;
    status: "BYTE_IDENTICAL";
  };
  discrepancy: {
    taskPackageLockedValueInterpretation: "UPSTREAM_LOGICAL_PRE_LOCK_FILE_RECORD_INTEGRITY";
    tarballDigestInterpretation: "INDEPENDENT_ARCHIVE_BYTE_INTEGRITY";
    valuesEqual: false;
    statement: string;
  };
}

export class GowmContractIntakeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GowmContractIntakeError";
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GowmContractIntakeError(message);
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    );
  });
  invariant(encoded !== undefined, "Cannot canonicalize an undefined value");
  return encoded;
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha512Sri(value: Uint8Array | string): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function canonicalSha256(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

function parseJson<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GowmContractIntakeError(`Cannot parse JSON ${filePath}: ${detail}`);
  }
}

function normalizeCanonicalLf(raw: Buffer, filePath: string): Buffer {
  const decoded = raw.toString("utf8");
  invariant(Buffer.from(decoded, "utf8").equals(raw), `${filePath} is not valid UTF-8 text`);
  const normalized = decoded.replace(/\r\n/g, "\n");
  invariant(!normalized.includes("\r"), `${filePath} contains a non-CRLF carriage return`);
  return Buffer.from(normalized, "utf8");
}

function portableRelativePath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

function listRegularFiles(root: string): string[] {
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return visit(entryPath);
      invariant(entry.isFile(), `Non-regular filesystem entry is not allowed: ${entryPath}`);
      invariant(!lstatSync(entryPath).isSymbolicLink(), `Symbolic links are not allowed: ${entryPath}`);
      return [entryPath];
    });
  return visit(root).sort((left, right) =>
    portableRelativePath(root, left).localeCompare(portableRelativePath(root, right))
  );
}

function readTarString(header: Buffer, offset: number, length: number): string {
  const field = header.subarray(offset, offset + length);
  const terminator = field.indexOf(0);
  return field.subarray(0, terminator === -1 ? field.length : terminator).toString("utf8");
}

function readTarNumber(header: Buffer, offset: number, length: number, label: string): number {
  const field = readTarString(header, offset, length).trim();
  if (field === "") return 0;
  invariant(/^[0-7]+$/.test(field), `Unsupported tar ${label} field: ${JSON.stringify(field)}`);
  return Number.parseInt(field, 8);
}

function parsePax(data: Buffer): Record<string, string> {
  const fields: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    invariant(space !== -1, "Malformed PAX record length");
    const lengthText = data.subarray(offset, space).toString("ascii");
    invariant(/^[1-9][0-9]*$/.test(lengthText), `Malformed PAX record length: ${lengthText}`);
    const recordEnd = offset + Number.parseInt(lengthText, 10);
    invariant(recordEnd <= data.length, "PAX record extends past its header payload");
    const record = data.subarray(space + 1, recordEnd - 1).toString("utf8");
    const equals = record.indexOf("=");
    invariant(equals > 0, `Malformed PAX record: ${record}`);
    fields[record.slice(0, equals)] = record.slice(equals + 1);
    offset = recordEnd;
  }
  return fields;
}

function assertSafeArchivePath(entryPath: string): void {
  invariant(entryPath !== "", "Tar entry path must not be empty");
  invariant(!entryPath.startsWith("/"), `Absolute tar path is not allowed: ${entryPath}`);
  invariant(!entryPath.includes("\\"), `Backslash tar path is not allowed: ${entryPath}`);
  invariant(
    !entryPath.split("/").some((segment) => segment === ".." || segment === ""),
    `Unsafe tar path is not allowed: ${entryPath}`
  );
}

function parseTarballFiles(tarball: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(tarball);
  const files = new Map<string, Buffer>();
  let offset = 0;
  let pendingPax: Record<string, string> = {};
  let globalPax: Record<string, string> = {};
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      invariant(tar.subarray(offset).every((byte) => byte === 0), "Non-zero data follows the tar terminator");
      break;
    }
    const expectedChecksum = readTarNumber(header, 148, 8, "checksum");
    let actualChecksum = 0;
    for (let index = 0; index < header.length; index += 1) {
      actualChecksum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
    }
    invariant(actualChecksum === expectedChecksum, `Tar header checksum mismatch at byte ${offset}`);
    const prefix = readTarString(header, 345, 155);
    const name = readTarString(header, 0, 100);
    const headerPath = prefix === "" ? name : `${prefix}/${name}`;
    const headerSize = readTarNumber(header, 124, 12, "size");
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + 512;
    const dataEnd = dataStart + headerSize;
    invariant(dataEnd <= tar.length, `Tar entry extends past archive boundary: ${headerPath}`);
    const data = tar.subarray(dataStart, dataEnd);
    if (typeFlag === "x" || typeFlag === "g") {
      const parsed = parsePax(data);
      if (typeFlag === "g") globalPax = { ...globalPax, ...parsed };
      else pendingPax = parsed;
    } else if (typeFlag === "0" || typeFlag === "\0") {
      const pax = { ...globalPax, ...pendingPax };
      const entryPath = pax["path"] ?? headerPath;
      const declaredSize = pax["size"] === undefined ? headerSize : Number.parseInt(pax["size"], 10);
      invariant(Number.isSafeInteger(declaredSize) && declaredSize >= 0, `Invalid PAX size for ${entryPath}`);
      invariant(declaredSize === data.length, `PAX size mismatch for ${entryPath}`);
      assertSafeArchivePath(entryPath);
      invariant(!files.has(entryPath), `Duplicate tar entry is not allowed: ${entryPath}`);
      files.set(entryPath, Buffer.from(data));
      pendingPax = {};
    } else if (typeFlag === "5") {
      pendingPax = {};
    } else {
      throw new GowmContractIntakeError(
        `Unsupported non-regular tar entry ${headerPath} with type ${JSON.stringify(typeFlag)}`
      );
    }
    offset = dataStart + Math.ceil(headerSize / 512) * 512;
  }
  invariant(files.size > 0, "Tarball contains no regular files");
  return files;
}

function loadAlignmentLock(repositoryRoot: string): GowmRuntimeContractAlignmentLock {
  const upstreamRoot = join(repositoryRoot, "contracts", "upstream");
  const lock = parseJson<GowmRuntimeContractAlignmentLock>(join(upstreamRoot, ALIGNMENT_LOCK_FILE_NAME));
  const schema = parseJson<Record<string, unknown>>(join(upstreamRoot, ALIGNMENT_LOCK_SCHEMA_FILE_NAME));
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  invariant(
    validate(lock),
    `GOWM runtime/contract alignment lock validation failed: ${ajv.errorsText(validate.errors, { separator: "; " })}`
  );
  invariant(lock.status === "LOCKED", "GOWM runtime/contract alignment authority is not LOCKED");
  invariant(lock.taskGeneratedAgainst.wsgsRepository === WSGS_SOURCE_REPOSITORY, "Alignment WSGS repository mismatch");
  invariant(lock.taskGeneratedAgainst.wsgsCommit === WSGS_SOURCE_COMMIT, "Alignment WSGS base commit mismatch");
  invariant(lock.taskGeneratedAgainst.wsgsVersion === WSGS_SOURCE_VERSION, "Alignment WSGS base version mismatch");
  invariant(lock.taskGeneratedAgainst.targetWsgsVersion === TARGET_VERSION, "Alignment WSGS target version mismatch");
  invariant(
    lock.taskGeneratedAgainst.northboundContractVersion === NORTHBOUND_CONTRACT_VERSION,
    "Alignment northbound contract version mismatch"
  );
  invariant(lock.gowmRuntime.repository === GOWM_SOURCE_REPOSITORY, "Alignment GOWM repository mismatch");
  invariant(lock.gowmRuntime.sourceCommit === GOWM_RUNTIME_SOURCE_COMMIT, "Alignment GOWM source commit mismatch");
  invariant(lock.gowmRuntime.softwareVersion === GOWM_RUNTIME_VERSION, "Alignment GOWM runtime version mismatch");
  invariant(
    lock.requiredTuple.gowmRuntimeVersion === GOWM_RUNTIME_VERSION,
    "Alignment required runtime version mismatch"
  );
  invariant(
    lock.requiredTuple.gatewayContractVersion === GOWM_GATEWAY_CONTRACT_VERSION &&
      lock.gatewayContract.gatewayContractVersion === GOWM_GATEWAY_CONTRACT_VERSION,
    "Alignment Gateway contract version mismatch"
  );
  invariant(
    lock.requiredTuple.gatewayConsumerPackageVersion === GOWM_CONSUMER_PACKAGE_VERSION &&
      lock.gatewayContract.packageVersion === GOWM_CONSUMER_PACKAGE_VERSION,
    "Alignment Gateway consumer package version mismatch"
  );
  invariant(lock.gatewayContract.packageName === GOWM_CONSUMER_PACKAGE_NAME, "Alignment package name mismatch");
  invariant(
    lock.requiredTuple.runtimeAndContractVersionsMustRemainIndependent === true &&
      lock.requiredTuple.runtimeVersionMustNotBeCopiedIntoContractVersion === true &&
      !Object.is(lock.requiredTuple.gowmRuntimeVersion, lock.requiredTuple.gatewayContractVersion),
    "Alignment runtime and Gateway contract versions are not independently pinned"
  );
  invariant(
    lock.gatewayContract.consumerLogicalIntegrity === GOWM_CONSUMER_LOGICAL_INTEGRITY,
    "Alignment consumer logical integrity mismatch"
  );
  invariant(
    lock.gatewayContract.contractCatalogRevision === GOWM_CONTRACT_CATALOG_REVISION &&
      lock.gatewayContract.semanticCatalogHash === GOWM_SEMANTIC_CATALOG_HASH &&
      lock.gatewayContract.availabilityContractHash === GOWM_AVAILABILITY_CONTRACT_HASH &&
      lock.gatewayContract.snapshotContractHash === GOWM_SNAPSHOT_CONTRACT_HASH &&
      lock.gatewayContract.delegationContractHash === GOWM_DELEGATION_CONTRACT_HASH,
    "Alignment Gateway contract hash tuple mismatch"
  );
  invariant(
    lock.gatewayContract.southboundLockFileSha256 === `sha256:${GOWM_SOUTHBOUND_LOCK_RAW_SHA256}`,
    "Alignment southbound raw-byte hash mismatch"
  );
  return lock;
}

function expectedSourceLock(alignmentLock: GowmRuntimeContractAlignmentLock): unknown {
  const { taskGeneratedAgainst, gowmRuntime, gatewayContract } = alignmentLock;
  invariant(
    gatewayContract.southboundLockFileSha256.startsWith("sha256:"),
    "Alignment southbound lock hash must use the sha256: prefix"
  );
  return {
    schemaVersion: "1.0",
    wsgsSource: {
      repository: taskGeneratedAgainst.wsgsRepository,
      commit: taskGeneratedAgainst.wsgsCommit,
      version: taskGeneratedAgainst.wsgsVersion
    },
    gowmSource: {
      repository: gowmRuntime.repository,
      commit: gowmRuntime.sourceCommit,
      version: gowmRuntime.softwareVersion
    },
    consumerPackage: {
      name: gatewayContract.packageName,
      version: gatewayContract.packageVersion,
      integrity: gatewayContract.consumerLogicalIntegrity,
      contractCatalogRevision: gatewayContract.contractCatalogRevision,
      semanticCatalogHash: gatewayContract.semanticCatalogHash,
      availabilityContractHash: gatewayContract.availabilityContractHash,
      snapshotContractHash: gatewayContract.snapshotContractHash,
      delegationContractHash: gatewayContract.delegationContractHash,
      southboundLockSha256: gatewayContract.southboundLockFileSha256.slice("sha256:".length)
    },
    northboundContractVersion: taskGeneratedAgainst.northboundContractVersion,
    targetVersion: taskGeneratedAgainst.targetWsgsVersion
  };
}

function expectedPackageIntegrityEvidence(): PackageIntegrityEvidence {
  return {
    schemaVersion: "1.0",
    logicalPackageIntegrity: GOWM_CONSUMER_LOGICAL_INTEGRITY,
    logicalIntegrityAlgorithm: "SHA512_BASE64_OF_CANONICAL_PRE_LOCK_FILE_RECORDS",
    tarball: {
      path: TARBALL_FILE_NAME,
      bytes: GOWM_CONSUMER_TARBALL_BYTES,
      sha256: GOWM_CONSUMER_TARBALL_SHA256,
      sha512: GOWM_CONSUMER_TARBALL_SHA512
    },
    materialization: {
      archiveFileCount: PACKAGE_FILE_COUNT,
      extractedFileCount: PACKAGE_FILE_COUNT,
      rawCrlfPackageFileCount: RAW_CRLF_PACKAGE_FILE_COUNT,
      treeSha256: GOWM_MATERIALIZATION_TREE_SHA256,
      status: "BYTE_IDENTICAL"
    },
    discrepancy: {
      taskPackageLockedValueInterpretation: "UPSTREAM_LOGICAL_PRE_LOCK_FILE_RECORD_INTEGRITY",
      tarballDigestInterpretation: "INDEPENDENT_ARCHIVE_BYTE_INTEGRITY",
      valuesEqual: false,
      statement:
        "The task-locked Kek value is the upstream logical integrity over canonical pre-lock file records; it is intentionally not the SHA-512 digest of the .tgz bytes."
    }
  };
}

function scanForRuntimeMaterial(files: Map<string, Buffer>): void {
  const forbiddenTopology =
    /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|providerBaseUrl|providerUrl|transportToken|databaseName|containerName|DATABASE_URL|PGHOST|PGPORT|postgres(?:ql)?:\/\/|mongodb(?:\+srv)?:\/\/|redis:\/\/)/iu;
  const forbiddenSecret =
    /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[oprsu]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b)/u;
  const urlPattern = /https?:\/\/[^\s"'`<>)}\]]+/gu;
  for (const [entryPath, bytes] of files) {
    const content = normalizeCanonicalLf(bytes, entryPath).toString("utf8");
    invariant(!forbiddenTopology.test(content), `Runtime provider or database topology leaked into ${entryPath}`);
    invariant(!forbiddenSecret.test(content), `Secret-like material leaked into ${entryPath}`);
    for (const match of content.matchAll(urlPattern)) {
      const url = match[0];
      invariant(url.startsWith("https://json-schema.org/"), `Provider or runtime URL leaked into ${entryPath}: ${url}`);
    }
  }
}

function buildReport(checks: IntakeCheck[]): ContractIntakeReport {
  return {
    schemaVersion: "1.0",
    sourceCommit: GOWM_RUNTIME_SOURCE_COMMIT,
    packageIntegrity: GOWM_CONSUMER_LOGICAL_INTEGRITY,
    checks,
    status: "PASS"
  };
}

export function verifyGowmContractIntake(
  options: VerifyGowmContractIntakeOptions = {}
): GowmContractIntakeSummary {
  const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const intakeRoot = resolve(options.intakeRoot ?? join(repositoryRoot, "contracts", "upstream", "gowm-0.6.3"));
  const extractedPackageRoot = join(intakeRoot, "extracted", "package");
  const bundleRoot = join(extractedPackageRoot, "bundle");
  const checks: IntakeCheck[] = [];
  const pass = (id: string, actual: string, expected = actual): void => {
    invariant(actual === expected, `${id}: expected ${expected}, received ${actual}`);
    checks.push({ id, status: "PASS", actual, expected });
  };

  const alignmentLock = loadAlignmentLock(repositoryRoot);
  const sourceLock = parseJson<unknown>(join(intakeRoot, "SOURCE_LOCK.json"));
  invariant(
    canonicalJson(sourceLock) === canonicalJson(expectedSourceLock(alignmentLock)),
    "SOURCE_LOCK.json is not the exact deterministic projection of the authorized alignment lock"
  );
  pass("source-lock", `${GOWM_RUNTIME_SOURCE_COMMIT}/${GOWM_CONSUMER_PACKAGE_NAME}@${GOWM_CONSUMER_PACKAGE_VERSION}`);

  const tarball = readFileSync(join(intakeRoot, TARBALL_FILE_NAME));
  pass("tarball-bytes", String(tarball.length), String(GOWM_CONSUMER_TARBALL_BYTES));
  pass("tarball-sha256", sha256Hex(tarball), GOWM_CONSUMER_TARBALL_SHA256);
  pass("tarball-sha512", sha512Sri(tarball), GOWM_CONSUMER_TARBALL_SHA512);

  const packageDocument = parseJson<Record<string, unknown>>(join(extractedPackageRoot, "package.json"));
  pass(
    "package-identity",
    `${String(packageDocument["name"])}@${String(packageDocument["version"])}`,
    `${GOWM_CONSUMER_PACKAGE_NAME}@${GOWM_CONSUMER_PACKAGE_VERSION}`
  );

  const manifest = parseJson<ConsumerManifest>(join(bundleRoot, "MANIFEST.json"));
  invariant(manifest.schemaVersion === "1.0", "Consumer MANIFEST schemaVersion must be 1.0");
  invariant(manifest.packageName === GOWM_CONSUMER_PACKAGE_NAME, "Consumer MANIFEST packageName mismatch");
  invariant(manifest.packageVersion === GOWM_CONSUMER_PACKAGE_VERSION, "Consumer MANIFEST packageVersion mismatch");
  invariant(Array.isArray(manifest.files), "Consumer MANIFEST files must be an array");
  pass("manifest-file-count", String(manifest.files.length), String(MANIFEST_FILE_COUNT));
  const manifestPaths = manifest.files.map((record) => record.path);
  invariant(new Set(manifestPaths).size === manifestPaths.length, "Consumer MANIFEST contains duplicate paths");
  invariant(
    canonicalJson(manifestPaths) === canonicalJson([...manifestPaths].sort((left, right) => left.localeCompare(right))),
    "Consumer MANIFEST file records are not path-sorted"
  );
  for (const record of manifest.files) {
    assertSafeArchivePath(record.path);
    invariant(Number.isSafeInteger(record.bytes) && record.bytes >= 0, `Invalid MANIFEST byte count: ${record.path}`);
    invariant(/^[0-9a-f]{64}$/.test(record.sha256), `Invalid MANIFEST SHA-256: ${record.path}`);
  }
  const bundleFiles = listRegularFiles(bundleRoot)
    .map((filePath) => portableRelativePath(bundleRoot, filePath))
    .filter((filePath) => filePath !== "MANIFEST.json");
  invariant(canonicalJson(bundleFiles) === canonicalJson(manifestPaths), "Consumer MANIFEST file set mismatch");

  let manifestRawByteFileCount = 0;
  for (const record of manifest.files) {
    const rawBytes = readFileSync(join(bundleRoot, ...record.path.split("/")));
    invariant(rawBytes.length === record.bytes, `Raw byte count mismatch for ${record.path}`);
    invariant(sha256Hex(rawBytes) === record.sha256, `Raw SHA-256 mismatch for ${record.path}`);
    manifestRawByteFileCount += 1;
  }
  pass(
    "manifest-raw-bytes-sha256",
    `${manifestRawByteFileCount}/${manifest.files.length}`,
    `${MANIFEST_FILE_COUNT}/${MANIFEST_FILE_COUNT}`
  );

  const preLockRecords = manifest.files.filter((record) => record.path !== LOCK_RELATIVE_PATH);
  invariant(preLockRecords.length === MANIFEST_FILE_COUNT - 1, "Unexpected upstream pre-lock record count");
  const logicalIntegrity = sha512Sri(canonicalJson(preLockRecords));
  pass("logical-package-integrity", logicalIntegrity, GOWM_CONSUMER_LOGICAL_INTEGRITY);
  invariant(manifest.packageIntegrity === logicalIntegrity, "Consumer MANIFEST logical package integrity mismatch");
  pass(
    "integrity-semantics",
    logicalIntegrity === GOWM_CONSUMER_TARBALL_SHA512
      ? "logical-pre-lock-records == tarball-bytes"
      : "logical-pre-lock-records != tarball-bytes",
    "logical-pre-lock-records != tarball-bytes"
  );

  const contractRevision = parseJson<Record<string, unknown>>(join(bundleRoot, "revisions", "contract-catalog.json"));
  pass("contract-catalog-revision", String(contractRevision["contractCatalogRevision"]), GOWM_CONTRACT_CATALOG_REVISION);
  pass("binding-revision", String(contractRevision["bindingRevision"]), GOWM_BINDING_REVISION);
  invariant(manifest.contractCatalogRevision === GOWM_CONTRACT_CATALOG_REVISION, "MANIFEST catalog revision mismatch");
  const semanticRevision = parseJson<Record<string, unknown>>(join(bundleRoot, "revisions", "semantic-catalog.json"));
  pass("semantic-catalog-hash", String(semanticRevision["semanticCatalogHash"]), GOWM_SEMANTIC_CATALOG_HASH);
  invariant(semanticRevision["contractCatalogRevision"] === GOWM_CONTRACT_CATALOG_REVISION, "Semantic catalog binding mismatch");
  invariant(manifest.semanticCatalogHash === GOWM_SEMANTIC_CATALOG_HASH, "MANIFEST semantic hash mismatch");

  const availabilitySchema = parseJson<unknown>(
    join(bundleRoot, "schemas", "gowm-v0.6.3", "operation-availability-list.schema.json")
  );
  const snapshotSchema = parseJson<unknown>(
    join(bundleRoot, "schemas", "gowm-v0.6.3", "query-snapshot-manifest.schema.json")
  );
  const delegationSchema = parseJson<unknown>(
    join(bundleRoot, "schemas", "gowm-v0.6.3", "delegated-identity-claims.schema.json")
  );
  pass("availability-contract-hash", canonicalSha256(availabilitySchema), GOWM_AVAILABILITY_CONTRACT_HASH);
  pass("snapshot-contract-hash", canonicalSha256(snapshotSchema), GOWM_SNAPSHOT_CONTRACT_HASH);
  pass("delegation-contract-hash", canonicalSha256(delegationSchema), GOWM_DELEGATION_CONTRACT_HASH);

  const lockPath = join(bundleRoot, ...LOCK_RELATIVE_PATH.split("/"));
  const lockRawBytes = readFileSync(lockPath);
  pass("southbound-lock-sha256", sha256Hex(lockRawBytes), GOWM_SOUTHBOUND_LOCK_RAW_SHA256);
  const lock = JSON.parse(lockRawBytes.toString("utf8")) as SouthboundOperationLock;
  const lockSchema = parseJson<Record<string, unknown>>(
    join(bundleRoot, "schemas", "gowm-v0.6.3", "wsgs-southbound-operation-lock-v2.schema.json")
  );
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  const validateLock = ajv.compile(lockSchema);
  invariant(
    validateLock(lock),
    `Southbound lock v2 schema validation failed: ${ajv.errorsText(validateLock.errors, { separator: "; " })}`
  );
  invariant(lock.gatewayContractVersion === GOWM_GATEWAY_CONTRACT_VERSION, "Southbound lock Gateway contract version mismatch");
  invariant(lock.consumerContractPackage.name === GOWM_CONSUMER_PACKAGE_NAME, "Southbound lock package name mismatch");
  invariant(lock.consumerContractPackage.version === GOWM_CONSUMER_PACKAGE_VERSION, "Southbound lock package version mismatch");
  invariant(lock.consumerContractPackage.integrity === logicalIntegrity, "Southbound lock logical integrity mismatch");
  invariant(lock.contractCatalogRevision === GOWM_CONTRACT_CATALOG_REVISION, "Southbound lock catalog revision mismatch");
  invariant(lock.semanticCatalogHash === GOWM_SEMANTIC_CATALOG_HASH, "Southbound lock semantic hash mismatch");
  invariant(lock.availabilityContractHash === GOWM_AVAILABILITY_CONTRACT_HASH, "Southbound lock availability hash mismatch");
  invariant(lock.snapshotContractHash === GOWM_SNAPSHOT_CONTRACT_HASH, "Southbound lock snapshot hash mismatch");
  invariant(lock.delegationContractHash === GOWM_DELEGATION_CONTRACT_HASH, "Southbound lock delegation hash mismatch");
  const operationKeys = [...lock.defaultOperations, ...lock.previewOperations].map(
    (operation) => `${operation.operationId}@${operation.operationVersion}`
  );
  invariant(new Set(operationKeys).size === operationKeys.length, "Southbound lock contains duplicate operations");
  invariant(lock.defaultOperations.every((operation) => operation.maturity === "STABLE"), "Default operation is not STABLE");
  invariant(lock.previewOperations.every((operation) => operation.maturity === "PREVIEW"), "Preview operation is not PREVIEW");
  pass(
    "southbound-lock-schema-v2",
    `${lock.schemaVersion};default=${lock.defaultOperations.length};preview=${lock.previewOperations.length}`,
    `2.0;default=${DEFAULT_OPERATION_COUNT};preview=${PREVIEW_OPERATION_COUNT}`
  );

  const compatibility = parseJson<Record<string, unknown>>(join(bundleRoot, "compatibility", "report.json"));
  const breakingChanges = compatibility["breakingChanges"];
  const promotedOperations = compatibility["promotedOperations"];
  invariant(Array.isArray(breakingChanges), "Compatibility breakingChanges must be an array");
  invariant(Array.isArray(promotedOperations), "Compatibility promotedOperations must be an array");
  pass(
    "compatibility-report",
    `${String(compatibility["classification"])};breaking=${breakingChanges.length};promoted=${promotedOperations.length}`,
    "ADDITIVE;breaking=0;promoted=10"
  );

  const extractedFiles = listRegularFiles(extractedPackageRoot);
  const extractedRecords: PackageFileRecord[] = extractedFiles.map((filePath) => {
    const bytes = readFileSync(filePath);
    return { path: portableRelativePath(extractedPackageRoot, filePath), bytes: bytes.length, sha256: sha256Hex(bytes) };
  });
  pass("extracted-file-count", String(extractedRecords.length), String(PACKAGE_FILE_COUNT));
  const rawCrlfPackageFileCount = extractedFiles.filter((filePath) =>
    readFileSync(filePath).includes(Buffer.from("\r\n", "ascii"))
  ).length;
  pass("raw-crlf-materialization-count", String(rawCrlfPackageFileCount), String(RAW_CRLF_PACKAGE_FILE_COUNT));
  pass(
    "materialization-tree-sha256",
    `sha256:${sha256Hex(canonicalJson(extractedRecords))}`,
    GOWM_MATERIALIZATION_TREE_SHA256
  );

  const archiveFiles = parseTarballFiles(tarball);
  pass("archive-file-count", String(archiveFiles.size), String(PACKAGE_FILE_COUNT));
  const expectedArchivePaths = extractedRecords.map((record) => `package/${record.path}`);
  const archivePaths = [...archiveFiles.keys()].sort((left, right) => left.localeCompare(right));
  invariant(canonicalJson(archivePaths) === canonicalJson(expectedArchivePaths), "Tarball and extracted file sets differ");
  for (const record of extractedRecords) {
    const archivePath = `package/${record.path}`;
    const archived = archiveFiles.get(archivePath);
    invariant(archived !== undefined, `Tarball is missing ${archivePath}`);
    invariant(
      archived.equals(readFileSync(join(extractedPackageRoot, ...record.path.split("/")))),
      `Tarball and extracted bytes differ for ${archivePath}`
    );
  }
  pass("archive-extracted-materialization", `${archiveFiles.size} byte-identical files`);
  scanForRuntimeMaterial(archiveFiles);
  pass("provider-url-token-db-topology-secrets", "0", "0");

  if (options.verifyRecordedEvidence !== false) {
    const packageIntegrityEvidence = parseJson<unknown>(join(intakeRoot, "PACKAGE_INTEGRITY"));
    invariant(
      canonicalJson(packageIntegrityEvidence) === canonicalJson(expectedPackageIntegrityEvidence()),
      "PACKAGE_INTEGRITY does not match independently verified logical, archive, and materialization evidence"
    );
    pass("package-integrity-evidence", "CURRENT", "CURRENT");
    const recordedReport = parseJson<unknown>(join(intakeRoot, "CONTRACT_INTAKE_REPORT.json"));
    invariant(
      canonicalJson(recordedReport) === canonicalJson(buildReport(checks)),
      "CONTRACT_INTAKE_REPORT.json is stale or does not exactly describe the verified intake"
    );
  }

  return {
    status: "PASS",
    sourceCommit: GOWM_RUNTIME_SOURCE_COMMIT,
    runtimeVersion: GOWM_RUNTIME_VERSION,
    gatewayContractVersion: GOWM_GATEWAY_CONTRACT_VERSION,
    packageName: GOWM_CONSUMER_PACKAGE_NAME,
    packageVersion: GOWM_CONSUMER_PACKAGE_VERSION,
    packageIntegrity: GOWM_CONSUMER_LOGICAL_INTEGRITY,
    tarballBytes: GOWM_CONSUMER_TARBALL_BYTES,
    tarballSha256: GOWM_CONSUMER_TARBALL_SHA256,
    tarballSha512: GOWM_CONSUMER_TARBALL_SHA512,
    manifestFileCount: MANIFEST_FILE_COUNT,
    manifestRawByteFileCount: MANIFEST_FILE_COUNT,
    rawCrlfPackageFileCount: RAW_CRLF_PACKAGE_FILE_COUNT,
    archiveFileCount: PACKAGE_FILE_COUNT,
    extractedFileCount: PACKAGE_FILE_COUNT,
    materializationTreeSha256: GOWM_MATERIALIZATION_TREE_SHA256,
    defaultOperationCount: DEFAULT_OPERATION_COUNT,
    previewOperationCount: PREVIEW_OPERATION_COUNT,
    checks
  };
}

export function expectedGowmPackageIntegrityEvidence(): Readonly<PackageIntegrityEvidence> {
  return expectedPackageIntegrityEvidence();
}

export * from "./schema-registry.js";
export * from "./operational-lock.js";
