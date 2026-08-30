import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  GOWM_SOUTHBOUND_LOCK_RAW_SHA256,
  loadOperationalGowmLock,
  OperationalGowmLockError
} from "./index.js";

const temporaryDirectories: string[] = [];
const bundledLockPath = fileURLToPath(new URL(
  "../../../contracts/upstream/gowm-0.6.3/extracted/package/bundle/locks/wsgs-southbound-operation-lock-v2.json",
  import.meta.url
));

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
  it("loads the bundled lock using its exact raw-byte hash", () => {
    const loaded = loadOperationalGowmLock({
      lockPath: bundledLockPath,
      expectedSha256: `sha256:${GOWM_SOUTHBOUND_LOCK_RAW_SHA256}`,
      hashMode: "EXACT_BYTES"
    });

    expect(loaded.lock.defaultOperations).toHaveLength(31);
    expect(loaded.lock.previewOperations).toHaveLength(89);
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
