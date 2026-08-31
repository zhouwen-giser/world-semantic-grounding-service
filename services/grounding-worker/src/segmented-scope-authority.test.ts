import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OperationLock } from "@wsgs/gowm-gateway-client";
import { afterEach, describe, expect, it } from "vitest";

import { loadSegmentedScopeAuthority } from "./segmented-scope-authority.js";

const temporaryDirectories: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const sha256 = (bytes: Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const foundation: OperationLock = {
  operationId: "reference.resolve",
  operationVersion: "1.0",
  inputSchemaHash: digest("1"),
  outputSchemaHash: digest("2"),
  semanticProfileHash: digest("3"),
  maturity: "STABLE"
};
const selected: OperationLock = {
  operationId: "geo-raster.sample",
  operationVersion: "1.0",
  inputSchemaHash: digest("4"),
  outputSchemaHash: digest("5"),
  semanticProfileHash: digest("6"),
  maturity: "PREVIEW"
};

function operation(value: OperationLock, availability = false) {
  return {
    operationId: value.operationId,
    operationVersion: value.operationVersion,
    inputSchemaHash: value.inputSchemaHash,
    outputSchemaHash: value.outputSchemaHash,
    semanticProfileHash: value.semanticProfileHash,
    maturity: value.maturity,
    ...(availability ? { availability: "AVAILABLE" } : {})
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wsgs-segmented-authority-"));
  temporaryDirectories.push(root);
  const gowm = join(root, "gowm");
  const gdps = join(root, "gdps");
  mkdirSync(gowm);
  mkdirSync(gdps);
  writeFileSync(join(gowm, "INSTANCE_MANIFEST.json"), JSON.stringify({
    schemaVersion: "1.0",
    runtimeInstanceId: "runtime-1",
    instanceId: "instance-1",
    fixtureId: "fixture-1",
    fixtureVersion: "1.0.0",
    authMode: "SIGNED_DELEGATION_V1",
    dataScope: "wsgs-demo",
    operationLockHash: digest("a"),
    stableOperations: ["reference.resolve@1.0"]
  }));
  writeFileSync(join(gowm, "INSTANCE_BINDING.json"), JSON.stringify({
    schemaVersion: "1.0",
    runtimeInstanceId: "runtime-1",
    instanceId: "instance-1",
    fixtureId: "fixture-1",
    fixtureVersion: "1.0.0",
    operationContracts: [operation(foundation)]
  }));
  const datasetBytes = Buffer.from(JSON.stringify({
    schemaVersion: "gdps-v021-sample-dataset-lock/1.0",
    scope: "scope-gdps-v021-baseline",
    products: []
  }));
  const capabilityBytes = Buffer.from(JSON.stringify({
    schemaVersion: "gdps-v021-capability-lock/1.0",
    providerId: "gdps.geospatial-products",
    operations: [operation(selected, true)]
  }));
  writeFileSync(join(gdps, "GDPS_SAMPLE_DATASET_LOCK.json"), datasetBytes);
  writeFileSync(join(gdps, "GDPS_CAPABILITY_LOCK.json"), capabilityBytes);
  const businessFiles = [
    ["GDPS_CAPABILITY_LOCK.json", sha256(capabilityBytes)],
    ["GDPS_CONSUMER_LOCK.json", digest("b")],
    ["GDPS_PRODUCT_DESCRIPTOR_LOCK.json", digest("c")],
    ["GDPS_RECIPE_LOCK.json", digest("d")],
    ["GDPS_SAMPLE_DATASET_LOCK.json", sha256(datasetBytes)],
    ["GOWM_GATEWAY_BINDING_LOCK.json", digest("e")],
    ["WSGS_QUERY_CORPUS.json", digest("f")],
    ["WSGS_TEST_BASELINE.json", digest("0")]
  ].map(([path, hash]) => ({ path, sha256: hash }));
  writeFileSync(join(gdps, "CHECKSUMS.json"), JSON.stringify({
    schemaVersion: "wsgs-gdps-v021-checksums/1.0",
    algorithm: "SHA-256",
    files: businessFiles,
    bundleHash: digest("9")
  }));
  return { gowm, gdps };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("segmented scope authority loader", () => {
  it("binds exact foundation and selected-dataset scopes from server-side locked handoffs", () => {
    const paths = fixture();
    const loaded = loadSegmentedScopeAuthority({
      foundationHandoffDirectory: paths.gowm,
      gdpsHandoffDirectory: paths.gdps,
      foundationOperations: [foundation],
      selectedDatasetOperations: [selected]
    });
    expect(loaded.authority.requiredDataScopes).toEqual(["scope-gdps-v021-baseline", "wsgs-demo"]);
    expect(loaded.authority).toMatchObject({
      foundationInstanceBindingHash: loaded.foundationInstanceBindingHash,
      gdpsChecksumsHash: loaded.gdpsChecksumsHash
    });
    expect(loaded.authority.bindings["reference.resolve@1.0"]).toMatchObject({
      role: "FOUNDATION",
      dataScope: "wsgs-demo"
    });
    expect(loaded.authority.bindings["geo-raster.sample@1.0"]).toMatchObject({
      role: "SELECTED_DATASET",
      dataScope: "scope-gdps-v021-baseline"
    });
  });

  it("fails closed when the dataset bytes drift from CHECKSUMS", () => {
    const paths = fixture();
    writeFileSync(join(paths.gdps, "GDPS_SAMPLE_DATASET_LOCK.json"), "{}\n");
    expect(() => loadSegmentedScopeAuthority({
      foundationHandoffDirectory: paths.gowm,
      gdpsHandoffDirectory: paths.gdps,
      foundationOperations: [foundation],
      selectedDatasetOperations: [selected]
    })).toThrowError(expect.objectContaining({ code: "GDPS_HANDOFF_CHECKSUM_MISMATCH" }));
  });

  it("fails closed when a selected operation is absent from the GDPS capability authority", () => {
    const paths = fixture();
    expect(() => loadSegmentedScopeAuthority({
      foundationHandoffDirectory: paths.gowm,
      gdpsHandoffDirectory: paths.gdps,
      foundationOperations: [foundation],
      selectedDatasetOperations: [{ ...selected, outputSchemaHash: digest("7") }]
    })).toThrowError(expect.objectContaining({ code: "GDPS_CAPABILITY_OPERATION_LOCK_DRIFT" }));
  });

  it("fails closed when GOWM manifest and binding identify different runtime instances", () => {
    const paths = fixture();
    const bindingPath = join(paths.gowm, "INSTANCE_BINDING.json");
    const binding = JSON.parse(readFileSync(bindingPath, "utf8")) as Record<string, unknown>;
    writeFileSync(bindingPath, JSON.stringify({ ...binding, runtimeInstanceId: "runtime-2" }));
    expect(() => loadSegmentedScopeAuthority({
      foundationHandoffDirectory: paths.gowm,
      gdpsHandoffDirectory: paths.gdps,
      foundationOperations: [foundation],
      selectedDatasetOperations: [selected]
    })).toThrowError(expect.objectContaining({ code: "GOWM_INSTANCE_HANDOFF_BINDING_MISMATCH" }));
  });

  it("binds exact GOWM binding and GDPS CHECKSUMS bytes into the authority hash", () => {
    const paths = fixture();
    const first = loadSegmentedScopeAuthority({
      foundationHandoffDirectory: paths.gowm,
      gdpsHandoffDirectory: paths.gdps,
      foundationOperations: [foundation],
      selectedDatasetOperations: [selected]
    });
    const bindingPath = join(paths.gowm, "INSTANCE_BINDING.json");
    const binding = JSON.parse(readFileSync(bindingPath, "utf8")) as Record<string, unknown>;
    writeFileSync(bindingPath, JSON.stringify({ ...binding, bindingRevision: digest("8") }));
    const second = loadSegmentedScopeAuthority({
      foundationHandoffDirectory: paths.gowm,
      gdpsHandoffDirectory: paths.gdps,
      foundationOperations: [foundation],
      selectedDatasetOperations: [selected]
    });
    expect(second.foundationInstanceBindingHash).not.toBe(first.foundationInstanceBindingHash);
    expect(second.authority.authorityHash).not.toBe(first.authority.authorityHash);
  });
});
