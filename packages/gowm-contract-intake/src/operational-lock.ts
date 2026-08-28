import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

export type OperationalLockHashMode = "CANONICAL_LF" | "EXACT_BYTES";

export interface OperationalLockEntry {
  readonly operationId: string;
  readonly operationVersion: string;
  readonly inputSchemaHash: `sha256:${string}`;
  readonly outputSchemaHash: `sha256:${string}`;
  readonly semanticProfileHash: `sha256:${string}`;
  readonly maturity: "STABLE" | "PREVIEW";
  readonly requiredPermissions: readonly string[];
  readonly snapshotSupport: "NONE" | "BEST_EFFORT" | "CONSISTENT_AT_START" | "PINNED";
}

export interface OperationalGowmLock {
  readonly schemaVersion: "2.0";
  readonly gatewayContractVersion: "0.6.3";
  readonly consumerContractPackage: {
    readonly name: "@gowm/world-gateway-contracts";
    readonly version: "0.6.3";
    readonly integrity: `sha512-${string}`;
  };
  readonly contractCatalogRevision: `sha256:${string}`;
  readonly semanticCatalogHash: `sha256:${string}`;
  readonly availabilityContractHash: `sha256:${string}`;
  readonly snapshotContractHash: `sha256:${string}`;
  readonly delegationContractHash: `sha256:${string}`;
  readonly defaultOperations: readonly OperationalLockEntry[];
  readonly previewOperations: readonly OperationalLockEntry[];
}

export interface LoadOperationalGowmLockOptions {
  readonly lockPath: string;
  readonly expectedSha256: `sha256:${string}`;
  readonly hashMode: OperationalLockHashMode;
  readonly schemaPath?: string;
}

export interface LoadedOperationalGowmLock {
  readonly lock: OperationalGowmLock;
  readonly lockHash: `sha256:${string}`;
  readonly hashMode: OperationalLockHashMode;
}

export class OperationalGowmLockError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "OperationalGowmLockError";
  }
}

function canonicalLfBytes(bytes: Buffer): Buffer {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes) || /\r(?!\n)/u.test(decoded)) {
    throw new OperationalGowmLockError("OPERATIONAL_LOCK_NOT_UTF8_TEXT");
  }
  return Buffer.from(decoded.replaceAll("\r\n", "\n"), "utf8");
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function defaultSchemaPath(): string {
  return fileURLToPath(new URL(
    "../../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/schemas/gowm-v0.6.3/wsgs-southbound-operation-lock-v2.schema.json",
    import.meta.url
  ));
}

function assertOperationalInvariants(lock: OperationalGowmLock): void {
  if (lock.defaultOperations.length !== 31 || lock.previewOperations.length !== 89) {
    throw new OperationalGowmLockError("OPERATIONAL_LOCK_OPERATION_COUNT_MISMATCH");
  }
  if (lock.defaultOperations.some((entry) => entry.maturity !== "STABLE")
    || lock.previewOperations.some((entry) => entry.maturity !== "PREVIEW")) {
    throw new OperationalGowmLockError("OPERATIONAL_LOCK_MATURITY_MISMATCH");
  }
  const keys = [...lock.defaultOperations, ...lock.previewOperations]
    .map((entry) => `${entry.operationId}@${entry.operationVersion}`);
  if (new Set(keys).size !== keys.length) {
    throw new OperationalGowmLockError("OPERATIONAL_LOCK_DUPLICATE_OPERATION");
  }
}

export function loadOperationalGowmLock(options: LoadOperationalGowmLockOptions): LoadedOperationalGowmLock {
  if (!/^sha256:[0-9a-f]{64}$/u.test(options.expectedSha256)) {
    throw new OperationalGowmLockError("OPERATIONAL_LOCK_EXPECTED_HASH_INVALID");
  }
  const bytes = readFileSync(options.lockPath);
  const hashedBytes = options.hashMode === "CANONICAL_LF" ? canonicalLfBytes(bytes) : bytes;
  const actual = sha256(hashedBytes);
  if (actual !== options.expectedSha256) {
    throw new OperationalGowmLockError(
      "OPERATIONAL_LOCK_INTEGRITY_MISMATCH",
      `Operational GOWM lock hash mismatch: expected ${options.expectedSha256}, observed ${actual}`
    );
  }

  let lock: unknown;
  try {
    lock = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new OperationalGowmLockError("OPERATIONAL_LOCK_JSON_INVALID");
  }
  const schema = JSON.parse(readFileSync(options.schemaPath ?? defaultSchemaPath(), "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020Module.default({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  const validate = ajv.compile(schema);
  if (!validate(lock)) {
    throw new OperationalGowmLockError(
      "OPERATIONAL_LOCK_SCHEMA_MISMATCH",
      `Operational GOWM lock schema mismatch: ${ajv.errorsText(validate.errors, { separator: "; " })}`
    );
  }
  assertOperationalInvariants(lock as OperationalGowmLock);
  return { lock: lock as OperationalGowmLock, lockHash: actual, hashMode: options.hashMode };
}
