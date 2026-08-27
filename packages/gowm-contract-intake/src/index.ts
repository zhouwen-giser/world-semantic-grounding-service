import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

export const GOWM_INTAKE_VERSION = "gowm-contract-intake/2.0" as const;
export const GOWM_SOURCE_REPOSITORY = "zhouwen-giser/geospatial-operational-world-model" as const;
export const GOWM_SOURCE_COMMIT = "17dd221330d9af540ec815a39eca96550690299a" as const;
export const GOWM_SOURCE_VERSION = "0.6.3" as const;
export const GOWM_CONSUMER_PACKAGE_NAME = "@gowm/world-gateway-contracts" as const;
export const GOWM_CONSUMER_PACKAGE_VERSION = "0.6.3" as const;
export const GOWM_CONSUMER_LOGICAL_INTEGRITY =
  "sha512-Z2mLu+us4NM8hqthMSo48H33cFpzxK9zxyx8UeB04F7LdWN0e6Vz5q++fB7ohyRikbXdgYCrT8+SMqwcuWEBLA==" as const;
export const GOWM_CONSUMER_TARBALL_BYTES = 52_931 as const;
export const GOWM_CONSUMER_TARBALL_SHA256 =
  "da86ab50c2cf4a925f958003a132902770bb2e6d2082cd0aaffb44d70e226501" as const;
export const GOWM_CONSUMER_TARBALL_SHA512 =
  "sha512-UP91UrKaxuwDwN31zzh452f4iQYfiuXEukfcJ/Ken0+JSKyVnCTWemWs+6ELErb+xR3oInEly1oigzFRxbwLpg==" as const;
export const GOWM_CONTRACT_CATALOG_REVISION =
  "sha256:1f49cdec6b5568c9ad57967f0b111e437c873e90b1213f17cc4006824a04c5d0" as const;
export const GOWM_BINDING_REVISION =
  "sha256:898fd2a69ff0b84dadf88ddf6cc2dc3b52838e1344888b65fb93d1869008e094" as const;
export const GOWM_SEMANTIC_CATALOG_HASH =
  "sha256:540e9b169cfefa5707e7ba7bd59d304c7671d8d0f2f1f0f4f16d5c5210b08b3e" as const;
export const GOWM_AVAILABILITY_CONTRACT_HASH =
  "sha256:66d6cfe2679d6bdd0cf6f22cb7153d1f5f4c934ebc286f6bac33ab6bd7eb4036" as const;
export const GOWM_SNAPSHOT_CONTRACT_HASH =
  "sha256:350044225667ce00c2850e9a9d7c86762fc2e042793b6a8666c724c763135ca0" as const;
export const GOWM_DELEGATION_CONTRACT_HASH =
  "sha256:6edf49002dc75e6701c9c56b8795539b3512884d31b66f7f12f122abdee9344b" as const;
export const GOWM_SOUTHBOUND_LOCK_LF_SHA256 =
  "51c189f2a4359b245b652eeb196410c742231db69dc0232d3f7057bb4368cdf0" as const;
export const GOWM_MATERIALIZATION_TREE_SHA256 =
  "sha256:d6a0f4ad900134ab06f00d2cbbf11f591d55e620d313b784741dd0e92808d8a7" as const;

const WSGS_SOURCE_REPOSITORY = "zhouwen-giser/world-semantic-grounding-service" as const;
const WSGS_SOURCE_COMMIT = "2fdefe3769189fa8e8be4302a9e98ca55cf686d4" as const;
const WSGS_SOURCE_VERSION = "0.1.0" as const;
const NORTHBOUND_CONTRACT_VERSION = "sacs-wsgs-grounding/1.0" as const;
const TARGET_VERSION = "0.2.0" as const;
const TARBALL_FILE_NAME = "gowm-world-gateway-contracts-0.6.3.tgz" as const;
const LOCK_RELATIVE_PATH = "locks/wsgs-southbound-operation-lock-v2.json" as const;
const MANIFEST_FILE_COUNT = 62 as const;
const PACKAGE_FILE_COUNT = 64 as const;
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
  sourceCommit: typeof GOWM_SOURCE_COMMIT;
  packageIntegrity: typeof GOWM_CONSUMER_LOGICAL_INTEGRITY;
  checks: IntakeCheck[];
  status: "PASS";
}

export interface GowmContractIntakeSummary {
  status: "PASS";
  sourceCommit: typeof GOWM_SOURCE_COMMIT;
  packageName: typeof GOWM_CONSUMER_PACKAGE_NAME;
  packageVersion: typeof GOWM_CONSUMER_PACKAGE_VERSION;
  packageIntegrity: typeof GOWM_CONSUMER_LOGICAL_INTEGRITY;
  tarballBytes: typeof GOWM_CONSUMER_TARBALL_BYTES;
  tarballSha256: typeof GOWM_CONSUMER_TARBALL_SHA256;
  tarballSha512: typeof GOWM_CONSUMER_TARBALL_SHA512;
  manifestFileCount: typeof MANIFEST_FILE_COUNT;
  canonicalLfFileCount: typeof MANIFEST_FILE_COUNT;
  rawCrlfPackageFileCount: typeof PACKAGE_FILE_COUNT;
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
  consumerContractPackage: { integrity: string };
  contractCatalogRevision: string;
  semanticCatalogHash: string;
  availabilityContractHash: string;
  snapshotContractHash: string;
  delegationContractHash: string;
  defaultOperations: SouthboundOperation[];
  previewOperations: SouthboundOperation[];
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
    rawCrlfPackageFileCount: typeof PACKAGE_FILE_COUNT;
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

function expectedSourceLock(): unknown {
  return {
    schemaVersion: "1.0",
    wsgsSource: { repository: WSGS_SOURCE_REPOSITORY, commit: WSGS_SOURCE_COMMIT, version: WSGS_SOURCE_VERSION },
    gowmSource: { repository: GOWM_SOURCE_REPOSITORY, commit: GOWM_SOURCE_COMMIT, version: GOWM_SOURCE_VERSION },
    consumerPackage: {
      name: GOWM_CONSUMER_PACKAGE_NAME,
      version: GOWM_CONSUMER_PACKAGE_VERSION,
      integrity: GOWM_CONSUMER_LOGICAL_INTEGRITY,
      contractCatalogRevision: GOWM_CONTRACT_CATALOG_REVISION,
      semanticCatalogHash: GOWM_SEMANTIC_CATALOG_HASH,
      availabilityContractHash: GOWM_AVAILABILITY_CONTRACT_HASH,
      snapshotContractHash: GOWM_SNAPSHOT_CONTRACT_HASH,
      delegationContractHash: GOWM_DELEGATION_CONTRACT_HASH,
      southboundLockSha256: GOWM_SOUTHBOUND_LOCK_LF_SHA256
    },
    northboundContractVersion: NORTHBOUND_CONTRACT_VERSION,
    targetVersion: TARGET_VERSION
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
      rawCrlfPackageFileCount: PACKAGE_FILE_COUNT,
      treeSha256: GOWM_MATERIALIZATION_TREE_SHA256,
      status: "BYTE_IDENTICAL"
    },
    discrepancy: {
      taskPackageLockedValueInterpretation: "UPSTREAM_LOGICAL_PRE_LOCK_FILE_RECORD_INTEGRITY",
      tarballDigestInterpretation: "INDEPENDENT_ARCHIVE_BYTE_INTEGRITY",
      valuesEqual: false,
      statement:
        "The task-package sha512-Z2m... value is the upstream logical integrity over canonical pre-lock file records; it is intentionally not the SHA-512 digest of the .tgz bytes."
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
    sourceCommit: GOWM_SOURCE_COMMIT,
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

  const sourceLock = parseJson<unknown>(join(intakeRoot, "SOURCE_LOCK.json"));
  invariant(
    canonicalJson(sourceLock) === canonicalJson(expectedSourceLock()),
    "SOURCE_LOCK.json does not exactly match the authorized WSGS/GOWM/package pins"
  );
  pass("source-lock", `${GOWM_SOURCE_COMMIT}/${GOWM_CONSUMER_PACKAGE_NAME}@${GOWM_CONSUMER_PACKAGE_VERSION}`);

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

  let canonicalLfFileCount = 0;
  for (const record of manifest.files) {
    const canonicalLf = normalizeCanonicalLf(
      readFileSync(join(bundleRoot, ...record.path.split("/"))),
      record.path
    );
    invariant(canonicalLf.length === record.bytes, `LF byte count mismatch for ${record.path}`);
    invariant(sha256Hex(canonicalLf) === record.sha256, `LF SHA-256 mismatch for ${record.path}`);
    canonicalLfFileCount += 1;
  }
  pass(
    "manifest-lf-bytes-sha256",
    `${canonicalLfFileCount}/${manifest.files.length}`,
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
  const lockLf = normalizeCanonicalLf(readFileSync(lockPath), LOCK_RELATIVE_PATH);
  pass("southbound-lock-lf-sha256", sha256Hex(lockLf), GOWM_SOUTHBOUND_LOCK_LF_SHA256);
  const lock = JSON.parse(lockLf.toString("utf8")) as SouthboundOperationLock;
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
  pass("raw-crlf-materialization-count", String(rawCrlfPackageFileCount), String(PACKAGE_FILE_COUNT));
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
    sourceCommit: GOWM_SOURCE_COMMIT,
    packageName: GOWM_CONSUMER_PACKAGE_NAME,
    packageVersion: GOWM_CONSUMER_PACKAGE_VERSION,
    packageIntegrity: GOWM_CONSUMER_LOGICAL_INTEGRITY,
    tarballBytes: GOWM_CONSUMER_TARBALL_BYTES,
    tarballSha256: GOWM_CONSUMER_TARBALL_SHA256,
    tarballSha512: GOWM_CONSUMER_TARBALL_SHA512,
    manifestFileCount: MANIFEST_FILE_COUNT,
    canonicalLfFileCount: MANIFEST_FILE_COUNT,
    rawCrlfPackageFileCount: PACKAGE_FILE_COUNT,
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
