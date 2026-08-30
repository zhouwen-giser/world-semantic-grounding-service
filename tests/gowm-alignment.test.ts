import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AlignmentInvariantError,
  validateAlignmentLockDocument
} from "../validation/scripts/verify-gowm-alignment.js";

const lockPath = resolve("contracts/upstream/gowm-runtime-contract-alignment-lock-v1.json");

function loadLock(): Record<string, any> {
  return JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, any>;
}

const negativeCases: Array<{
  id: string;
  code: string;
  mutate: (document: Record<string, any>) => void;
}> = [
  { id: "runtime-version", code: "GOWM_RUNTIME_VERSION_MISMATCH", mutate: (doc) => { doc.gowmRuntime.softwareVersion = "0.6.3"; } },
  { id: "gateway-contract-version", code: "GATEWAY_CONTRACT_VERSION_MISMATCH", mutate: (doc) => { doc.gatewayContract.gatewayContractVersion = "0.6.4"; } },
  { id: "gateway-package-version", code: "GATEWAY_PACKAGE_VERSION_MISMATCH", mutate: (doc) => { doc.gatewayContract.packageVersion = "0.6.4"; } },
  { id: "source-commit", code: "GOWM_SOURCE_COMMIT_MISMATCH", mutate: (doc) => { doc.gowmRuntime.sourceCommit = "17dd221330d9af540ec815a39eca96550690299a"; } },
  { id: "wire-schema", code: "UNEXPECTED_WIRE_SCHEMA_DRIFT", mutate: (doc) => { doc.criticalOperationFingerprints[0].inputSchemaHash = `sha256:${"f".repeat(64)}`; } },
  { id: "semantic-profile", code: "UNDECLARED_SEMANTIC_PROFILE_DRIFT", mutate: (doc) => { doc.criticalOperationFingerprints[3].semanticProfileHash = `sha256:${"f".repeat(64)}`; } },
  { id: "version-conflation", code: "RUNTIME_CONTRACT_VERSION_CONFLATED", mutate: (doc) => { doc.requiredTuple.runtimeAndContractVersionsMustRemainIndependent = false; } },
  { id: "multiple-authorities", code: "MULTIPLE_UPSTREAM_AUTHORITIES", mutate: (doc) => { doc.compatibilityPolicy.singleUpstreamAuthorityRequired = false; } },
  { id: "fail-open", code: "ALIGNMENT_MUST_FAIL_CLOSED", mutate: (doc) => { doc.compatibilityPolicy.failClosed = false; } }
];

describe("GOWM runtime / Gateway contract alignment invariant", () => {
  it("accepts the frozen 0.6.4 runtime / 0.6.3 wire tuple", () => {
    expect(validateAlignmentLockDocument(loadLock())).toMatchObject({
      status: "PASS",
      runtimeVersion: "0.6.4",
      gatewayContractVersion: "0.6.3",
      criticalOperationCount: 7,
      declaredSemanticMigrationCount: 3
    });
  });

  for (const testCase of negativeCases) {
    it(`fails closed with stable code for ${testCase.id}`, () => {
      const document = structuredClone(loadLock());
      testCase.mutate(document);
      try {
        validateAlignmentLockDocument(document);
        throw new Error(`NEGATIVE_CASE_UNEXPECTED_PASS:${testCase.id}`);
      } catch (error) {
        expect(error).toBeInstanceOf(AlignmentInvariantError);
        expect((error as AlignmentInvariantError).code).toBe(testCase.code);
      }
    });
  }
});
