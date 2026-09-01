import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalStasGdpsInputHash,
  loadStasGdpsFixtureLock
} from "./stas-gdps-fixture-lock.js";

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function fixture() {
  const operationInput = {
    dataScopeId: "00000000-0000-4000-8000-000000000001",
    dimensionPolicy: "2D",
    timeRange: { start: "2026-08-13T01:00:00.000Z", end: "2026-08-13T01:00:06.000Z" },
    trackletA: { trackletId: "40000000-0000-4000-8000-000000000001", versionNo: 1 },
    trackletB: { trackletId: "40000000-0000-4000-8000-000000000002", versionNo: 1 },
    uncertaintyPolicy: "NOMINAL_WITH_SCALAR_SENSITIVITY"
  };
  return {
    schemaVersion: "wsgs-stas-gdps-fixture-lock/1.0",
    recipeId: "stas-nearest-approach-gdps-current-context",
    semanticPattern: "STAS_NEAREST_APPROACH_WITH_GDPS_CONTEXT",
    authority: "WSGS",
    runtimeBinding: {
      gowmSourceCommit: "a".repeat(40),
      gdpsSourceCommit: "b".repeat(40),
      gatewayInstanceBindingHash: `sha256:${"c".repeat(64)}`,
      gdpsProviderImageDigest: `sha256:${"d".repeat(64)}`
    },
    operationInput,
    operationInputHash: canonicalStasGdpsInputHash(operationInput),
    eventGeometryPath: "/result/shortest_line/coordinates/0",
    products: [
      { productType: "SLOPE", productProfile: "DEGREE" },
      { productType: "LAND_COVER", productProfile: "DEFAULT" }
    ],
    allowedOperations: [{
      operationId: "stas.nearest-approach",
      operationVersion: "1.0",
      inputSchemaHash: "sha256:fa852ea7022341b5e4f93985af177c0eadf0085928ca0b7516111dfeb4b74dd1",
      outputSchemaHash: "sha256:7e6e2bad26790a6f049ac887951dc3c7409b12a3f8f6ae517de8be0ed606f1a6",
      semanticProfileHash: "sha256:ac083588969e1d02790e11ae380db6b5a7012abfe0664c170308341aa4dc8705"
    }, {
      operationId: "geo-raster.sample",
      operationVersion: "1.0",
      inputSchemaHash: "sha256:57983c08d1fafefac136dc44effa137500bca5580056bd68ec01b677747308d4",
      outputSchemaHash: "sha256:da086a0ab6c1a48ffeac7633acef50b0385851dbf4e9191c24a21f5cd414ecf0",
      semanticProfileHash: "sha256:c591c93b448564f1508387ee7609efc6c474fd57fde7c6a2394057cf4fdda4cd"
    }]
  };
}

function materialize(value: unknown) {
  const directory = mkdtempSync(resolve(tmpdir(), "wsgs-stas-gdps-lock-"));
  directories.push(directory);
  const path = resolve(directory, "fixture-lock.json");
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  writeFileSync(path, bytes);
  return {
    path,
    hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` as `sha256:${string}`
  };
}

describe("STAS plus GDPS runtime fixture lock", () => {
  it("loads only an exact runtime, operation and canonical input lock", () => {
    const value = fixture();
    const file = materialize(value);

    const loaded = loadStasGdpsFixtureLock({ lockPath: file.path, expectedSha256: file.hash });
    expect(loaded.lockHash).toBe(file.hash);
    expect(loaded.lock.operationInputHash).toBe(canonicalStasGdpsInputHash(value.operationInput));
    expect(loaded.lock.allowedOperations.map((entry) => entry.operationId)).toEqual([
      "stas.nearest-approach", "geo-raster.sample"
    ]);
  });

  it("rejects byte drift, canonical input drift and operation hash drift", () => {
    const value = fixture();
    const original = materialize(value);
    expect(() => loadStasGdpsFixtureLock({
      lockPath: original.path,
      expectedSha256: `sha256:${"0".repeat(64)}`
    })).toThrow(/INTEGRITY_MISMATCH/u);

    value.operationInput.trackletA.versionNo = 2;
    const changedInput = materialize(value);
    expect(() => loadStasGdpsFixtureLock({
      lockPath: changedInput.path,
      expectedSha256: changedInput.hash
    })).toThrow(/TRACKLET_REFERENCE_INVALID|OPERATION_INPUT_HASH_MISMATCH/u);

    const changedOperation = fixture();
    changedOperation.allowedOperations[0]!.inputSchemaHash = `sha256:${"0".repeat(64)}`;
    const operationFile = materialize(changedOperation);
    expect(() => loadStasGdpsFixtureLock({
      lockPath: operationFile.path,
      expectedSha256: operationFile.hash
    })).toThrow(/OPERATION_LOCK_DRIFT/u);
  });
});
