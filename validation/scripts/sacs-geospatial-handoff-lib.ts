import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export const SACS_GEOSPATIAL_BUSINESS_FILES = Object.freeze([
  "WSGS_SACS_GEOSPATIAL_CONSUMER_LOCK.json",
  "WSGS_GROUNDING_RESULT_EXTENSION_SCHEMA_LOCK.json",
  "WSGS_WORLD_FINDING_SCHEMA_LOCK.json",
  "WSGS_SOURCE_PRODUCT_SCHEMA_LOCK.json",
  "WSGS_TYPED_GAP_SCHEMA_LOCK.json",
  "WSGS_STRUCTURED_SELECTION_SCHEMA_LOCK.json",
  "WSGS_CURRENTNESS_SCHEMA_LOCK.json",
  "WSGS_GEOSPATIAL_UPSTREAM_PROVENANCE_LOCK.json"
] as const);

export const SACS_GEOSPATIAL_INVENTORY = Object.freeze([
  ...SACS_GEOSPATIAL_BUSINESS_FILES,
  "CHECKSUMS.json"
] as const);

export type SacsGeospatialHandoffStatus = "BLOCKED" | "READY";

export class SacsGeospatialHandoffError extends Error {
  constructor(readonly code: string) {
    super("SACS geospatial handoff verification failed");
  }
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function sha256(value: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalHash(value: unknown): `sha256:${string}` {
  return sha256(JSON.stringify(canonicalize(value)));
}

export function jsonObject(bytes: Buffer, code: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new SacsGeospatialHandoffError(code);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SacsGeospatialHandoffError(code);
  }
  return value as Record<string, unknown>;
}

export function bundleHash(
  entries: readonly { filename: string; sha256: string; byteLength: number }[]
): `sha256:${string}` {
  return canonicalHash(entries.map(({ filename, sha256: hash, byteLength }) => ({
    filename,
    sha256: hash,
    byteLength
  })).sort((left, right) => left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0));
}

function forbidden(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => forbidden(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/^(password|secret|credential|environment|internalEndpoint|rawLog|rawToken|privateKey)$/iu.test(key)) {
        throw new SacsGeospatialHandoffError("HANDOFF_FORBIDDEN_FIELD");
      }
      forbidden(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && (
    /(?:https?|postgres(?:ql)?):\/\//iu.test(value) ||
    /^[A-Za-z]:\\/u.test(value) ||
    /BEGIN [A-Z ]*PRIVATE KEY/u.test(value) ||
    /TASK_PACKAGE_PROVISIONAL|provisional-consumer/iu.test(value)
  )) throw new SacsGeospatialHandoffError("HANDOFF_FORBIDDEN_VALUE");
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new SacsGeospatialHandoffError(code);
}

function verifySourceLock(repositoryRoot: string, lock: Record<string, unknown>): void {
  const sourceSchemaPath = lock["sourceSchemaPath"];
  const sourceSchemaSha256 = lock["sourceSchemaSha256"];
  if (typeof sourceSchemaPath !== "string" || typeof sourceSchemaSha256 !== "string" ||
      sha256(readFileSync(resolve(repositoryRoot, sourceSchemaPath))) !== sourceSchemaSha256) {
    throw new SacsGeospatialHandoffError("HANDOFF_SOURCE_SCHEMA_DRIFT");
  }
  const additional = lock["additionalSourceSchemas"];
  if (!Array.isArray(additional)) throw new SacsGeospatialHandoffError("HANDOFF_SOURCE_SCHEMA_LOCK_INVALID");
  for (const raw of additional) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new SacsGeospatialHandoffError("HANDOFF_SOURCE_SCHEMA_LOCK_INVALID");
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry["path"] !== "string" || typeof entry["sha256"] !== "string" ||
        sha256(readFileSync(resolve(repositoryRoot, entry["path"]))) !== entry["sha256"]) {
      throw new SacsGeospatialHandoffError("HANDOFF_SOURCE_SCHEMA_DRIFT");
    }
  }
  const generated = lock["generatedTypeFiles"];
  if (!Array.isArray(generated) || generated.length < 1) {
    throw new SacsGeospatialHandoffError("HANDOFF_GENERATED_TYPE_LOCK_INVALID");
  }
  for (const raw of generated) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new SacsGeospatialHandoffError("HANDOFF_GENERATED_TYPE_LOCK_INVALID");
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry["path"] !== "string" || typeof entry["sha256"] !== "string" ||
        sha256(readFileSync(resolve(repositoryRoot, entry["path"]))) !== entry["sha256"]) {
      throw new SacsGeospatialHandoffError("HANDOFF_GENERATED_TYPE_DRIFT");
    }
  }
  if (lock["generatedTypeSha256"] !== canonicalHash(generated)) {
    throw new SacsGeospatialHandoffError("HANDOFF_GENERATED_TYPE_SET_HASH_DRIFT");
  }
}

export interface VerifiedSacsGeospatialHandoff {
  status: SacsGeospatialHandoffStatus;
  bundleHash: `sha256:${string}`;
  consumerLockHash: `sha256:${string}`;
  inventoryCount: 8;
}

export function verifySacsGeospatialHandoff(input: {
  repositoryRoot: string;
  handoffDirectory: string;
  requireReady?: boolean;
}): VerifiedSacsGeospatialHandoff {
  const actual = readdirSync(input.handoffDirectory).sort();
  const expected = [...SACS_GEOSPATIAL_INVENTORY].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new SacsGeospatialHandoffError("HANDOFF_INVENTORY_MISMATCH");
  }
  const parsed = new Map<string, Record<string, unknown>>();
  const bytes = new Map<string, Buffer>();
  for (const filename of SACS_GEOSPATIAL_INVENTORY) {
    const raw = readFileSync(join(input.handoffDirectory, filename));
    if (raw.includes(0x0d)) throw new SacsGeospatialHandoffError("HANDOFF_LINE_ENDING_MISMATCH");
    const value = jsonObject(raw, "HANDOFF_JSON_INVALID");
    if (!raw.equals(Buffer.from(canonicalJson(value), "utf8"))) {
      throw new SacsGeospatialHandoffError("HANDOFF_CANONICAL_JSON_MISMATCH");
    }
    forbidden(value);
    bytes.set(filename, raw);
    parsed.set(filename, value);
  }
  const checksums = parsed.get("CHECKSUMS.json")!;
  exactKeys(checksums, [
    "schemaVersion", "inventoryCount", "encoding", "lineEnding", "canonicalJson", "files", "bundleHash"
  ], "HANDOFF_CHECKSUMS_SHAPE_INVALID");
  if (checksums["schemaVersion"] !== "wsgs-sacs-geospatial-checksums/1.0" ||
      checksums["inventoryCount"] !== 8 || checksums["encoding"] !== "UTF-8" ||
      checksums["lineEnding"] !== "LF" || checksums["canonicalJson"] !== "WSGS_CODE_POINT_SORTED_JSON_V1") {
    throw new SacsGeospatialHandoffError("HANDOFF_CHECKSUMS_METADATA_INVALID");
  }
  const files = checksums["files"];
  if (!Array.isArray(files) || files.length !== 8) throw new SacsGeospatialHandoffError("HANDOFF_CHECKSUM_COUNT_INVALID");
  const observedEntries: { filename: string; sha256: string; byteLength: number }[] = [];
  const observedNames = new Set<string>();
  for (const rawEntry of files) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      throw new SacsGeospatialHandoffError("HANDOFF_CHECKSUM_ENTRY_INVALID");
    }
    const entry = rawEntry as Record<string, unknown>;
    exactKeys(entry, ["filename", "role", "schemaVersion", "byteLength", "sha256"], "HANDOFF_CHECKSUM_ENTRY_INVALID");
    const filename = entry["filename"];
    if (typeof filename !== "string" || !SACS_GEOSPATIAL_BUSINESS_FILES.includes(
      filename as (typeof SACS_GEOSPATIAL_BUSINESS_FILES)[number]
    ) || observedNames.has(filename)) throw new SacsGeospatialHandoffError("HANDOFF_CHECKSUM_ENTRY_INVALID");
    const raw = bytes.get(filename)!;
    if (entry["byteLength"] !== raw.byteLength || entry["sha256"] !== sha256(raw)) {
      throw new SacsGeospatialHandoffError("HANDOFF_CHECKSUM_MISMATCH");
    }
    const document = parsed.get(filename)!;
    if (entry["schemaVersion"] !== document["schemaVersion"] &&
        entry["schemaVersion"] !== document["lockSchemaVersion"]) {
      throw new SacsGeospatialHandoffError("HANDOFF_SCHEMA_VERSION_MISMATCH");
    }
    observedNames.add(filename);
    observedEntries.push({ filename, sha256: entry["sha256"] as string, byteLength: entry["byteLength"] as number });
  }
  const computedBundleHash = bundleHash(observedEntries);
  if (checksums["bundleHash"] !== computedBundleHash) throw new SacsGeospatialHandoffError("HANDOFF_BUNDLE_HASH_MISMATCH");

  const consumer = parsed.get("WSGS_SACS_GEOSPATIAL_CONSUMER_LOCK.json")!;
  const consumerHash = consumer["consumerLockHash"];
  if (typeof consumerHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(consumerHash)) {
    throw new SacsGeospatialHandoffError("HANDOFF_CONSUMER_LOCK_HASH_INVALID");
  }
  const withoutHash = { ...consumer };
  delete withoutHash["consumerLockHash"];
  if (canonicalHash(withoutHash) !== consumerHash) {
    throw new SacsGeospatialHandoffError("HANDOFF_CONSUMER_LOCK_HASH_MISMATCH");
  }
  if (consumer["provenance"] !== "AUTHORITATIVE_WSGS_HANDOFF" ||
      !["BLOCKED", "READY"].includes(String(consumer["status"]))) {
    throw new SacsGeospatialHandoffError("HANDOFF_PROVENANCE_INVALID");
  }
  const status = consumer["status"] as SacsGeospatialHandoffStatus;
  if (input.requireReady && status !== "READY") throw new SacsGeospatialHandoffError("HANDOFF_NOT_READY");
  const provenance = parsed.get("WSGS_GEOSPATIAL_UPSTREAM_PROVENANCE_LOCK.json")!;
  if (provenance["provenance"] !== "AUTHORITATIVE_WSGS_HANDOFF" || provenance["status"] !== status) {
    throw new SacsGeospatialHandoffError("HANDOFF_PROVENANCE_CROSS_LOCK_MISMATCH");
  }
  for (const filename of SACS_GEOSPATIAL_BUSINESS_FILES.slice(1, 7)) {
    verifySourceLock(input.repositoryRoot, parsed.get(filename)!);
  }
  return Object.freeze({
    status,
    bundleHash: computedBundleHash,
    consumerLockHash: consumerHash as `sha256:${string}`,
    inventoryCount: 8
  });
}

export function relativeInventoryPath(root: string, path: string): string {
  return relative(root, resolve(path)).replaceAll("\\", "/");
}

export function inventoryRole(filename: string): string {
  return basename(filename, ".json").toLowerCase().replaceAll("_", "-");
}
