import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnalysisProviderContracts, isVerifiedAnalysisAuthorization } from "./analysis-provider-contracts.js";

describe("analysis provider exact contract intake", () => {
  it("validates all three manifests, six schemas, registries, source hashes and semantic profiles", () => {
    const contracts = new AnalysisProviderContracts();
    expect(contracts.authorizations).toHaveLength(3);
    for (const auth of contracts.authorizations) {
      expect(auth.operationVersion).toBe("0.1");
      expect(auth.semanticProfileHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(isVerifiedAnalysisAuthorization(auth)).toBe(true);
      expect(isVerifiedAnalysisAuthorization({ ...auth })).toBe(false);
    }
  });
  it("rejects invalid input and unavailable trajectory reference versions", () => {
    const contracts = new AnalysisProviderContracts();
    const input = { schemaVersion: "0.1", trajectoryReferenceKey: { namespace: "gowm", kind: "HISTORICAL_TRAJECTORY", id: "trace", version: "1" } };
    expect(() => contracts.validateInput("trajectory.map-match", input)).not.toThrow();
    expect(() => contracts.validateInput("trajectory.map-match", { ...input, schemaVersion: "1.0" })).toThrow("ANALYSIS_INPUT_SCHEMA_MISMATCH");
    expect(() => contracts.validateEnvelope("trajectory.map-match", { status: "COMPLETED" })).toThrow("ADVANCED_HISTORY_RESULT_INVALID");
  });
  it.each(["contracts/map-matching/map-match-request.schema.json", "contracts/manifests/temporal-events-provider.json", "source.json"])("fails closed on raw drift in %s", path => {
    const root = mkdtempSync(join(tmpdir(), "wsgs-analysis-contract-"));
    try {
      cpSync(fileURLToPath(new URL("../../../contracts/upstream/gowm-analysis-providers-current", import.meta.url)), root, { recursive: true });
      const file = join(root, path);
      writeFileSync(file, `${readFileSync(file, "utf8")} `);
      expect(() => new AnalysisProviderContracts(root)).toThrow("ANALYSIS_PROVIDER_CONTRACT_DRIFT");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
