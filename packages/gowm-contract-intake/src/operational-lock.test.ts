import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  currentGowmPath,
  currentGowmSnapshot,
  loadOperationalGowmLock,
  OperationalGowmLockError
} from "./index.js";

const temporaryDirectories: string[] = [];
const bundledLockPath = currentGowmPath(currentGowmSnapshot.lockPath);

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function temporaryLock(value: unknown): { path: string; hash: `sha256:${string}` } {
  const directory = mkdtempSync(join(tmpdir(), "wsgs-operational-lock-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "CONSUMER_CONTRACT_LOCK.json");
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  writeFileSync(path, bytes);
  return { path, hash: sha256(bytes) };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("operational GOWM lock intake", () => {
  it("validates a future formal schema without a hard-coded version ceiling", () => {
    const candidate = JSON.parse(readFileSync(bundledLockPath, "utf8"));
    candidate.gatewayContractVersion = "9.10.0";
    candidate.consumerContractPackage.version = "9.10.0";
    const pinned = temporaryLock(candidate);
    const schema = JSON.parse(readFileSync(currentGowmPath(currentGowmSnapshot.lockSchemaPath), "utf8"));
    schema.properties.gatewayContractVersion.const = "9.10.0";
    schema.properties.consumerContractPackage.properties.version.const = "9.10.0";
    const schemaFile = temporaryLock(schema);
    expect(loadOperationalGowmLock({ lockPath: pinned.path, expectedSha256: pinned.hash,
      hashMode: "EXACT_BYTES", schemaPath: schemaFile.path }).lock.gatewayContractVersion).toBe("9.10.0");
  });
  it("loads the bundled lock using its exact raw-byte hash", () => {
    const loaded = loadOperationalGowmLock({
      lockPath: bundledLockPath,
      expectedSha256: `sha256:${currentGowmSnapshot.lockSha256}`,
      hashMode: "EXACT_BYTES"
    });

    expect(loaded.lock.defaultOperations.length).toBeGreaterThan(0);
    expect(loaded.lock.gatewayContractVersion).toBe(currentGowmSnapshot.gatewayContractVersion);
    expect(loaded.hashMode).toBe("EXACT_BYTES");
  });

  it("accepts a separately pinned exact-byte candidate without changing the bundled lock", () => {
    const candidate = JSON.parse(readFileSync(bundledLockPath, "utf8")) as {
      contractCatalogRevision: string;
      semanticCatalogHash: string;
    };
    candidate.contractCatalogRevision = `sha256:${"a".repeat(64)}`;
    candidate.semanticCatalogHash = `sha256:${"b".repeat(64)}`;
    const pinned = temporaryLock(candidate);

    const loaded = loadOperationalGowmLock({
      lockPath: pinned.path,
      expectedSha256: pinned.hash,
      hashMode: "EXACT_BYTES"
    });

    expect(loaded.lock.contractCatalogRevision).toBe(candidate.contractCatalogRevision);
    expect(loaded.lock.semanticCatalogHash).toBe(candidate.semanticCatalogHash);
    expect(loaded.lockHash).toBe(pinned.hash);
  });

  it("accepts a schema-valid hash-locked extension subset under the explicit count policy", () => {
    const candidate = JSON.parse(readFileSync(bundledLockPath, "utf8")) as {
      defaultOperations: unknown[];
      previewOperations: unknown[];
    };
    candidate.defaultOperations = candidate.defaultOperations.slice(0, 12);
    candidate.previewOperations = candidate.previewOperations.slice(0, 7);
    const pinned = temporaryLock(candidate);

    const loaded = loadOperationalGowmLock({
      lockPath: pinned.path,
      expectedSha256: pinned.hash,
      hashMode: "EXACT_BYTES",
      operationCountPolicy: "HASH_LOCKED_EXTENSION"
    });

    expect(loaded.lock.defaultOperations).toHaveLength(12);
    expect(loaded.lock.previewOperations).toHaveLength(7);
  });

  it("fails closed on hash drift before trusting candidate JSON", () => {
    const candidate = JSON.parse(readFileSync(bundledLockPath, "utf8")) as unknown;
    const pinned = temporaryLock(candidate);

    expect(() => loadOperationalGowmLock({
      lockPath: pinned.path,
      expectedSha256: `sha256:${"0".repeat(64)}`,
      hashMode: "EXACT_BYTES"
    })).toThrowError(expect.objectContaining<Partial<OperationalGowmLockError>>({
      code: "OPERATIONAL_LOCK_INTEGRITY_MISMATCH"
    }));
  });

  it("rejects a hash-pinned document that violates the v2 schema", () => {
    const candidate = JSON.parse(readFileSync(bundledLockPath, "utf8")) as {
      schemaVersion: string;
    };
    candidate.schemaVersion = "unexpected";
    const pinned = temporaryLock(candidate);

    expect(() => loadOperationalGowmLock({
      lockPath: pinned.path,
      expectedSha256: pinned.hash,
      hashMode: "EXACT_BYTES"
    })).toThrowError(expect.objectContaining<Partial<OperationalGowmLockError>>({
      code: "OPERATIONAL_LOCK_SCHEMA_MISMATCH"
    }));
  });
});
