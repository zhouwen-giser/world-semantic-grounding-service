import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorldAnalysisValidator, worldAnalysisResultHash } from "@wsgs/contracts";
import { assembleProductionWorldAnalysis } from "./world-analysis-result.js";

const example = (name: string) => JSON.parse(readFileSync(new URL(`../../../contracts/wsgs-v0.2.4-world-analysis/examples/${name}.json`, import.meta.url), "utf8"));
const validate = createWorldAnalysisValidator();
function assemble(base: Record<string, unknown>) {
  return assembleProductionWorldAnalysis({ base, runFingerprint: `sha256:${"b".repeat(64)}`,
    validUntil: "2026-09-06T00:01:00Z", maxResultBytes: 1048576, foundationEvidenceIds: [] });
}

describe("production world-analysis consumer boundary", () => {
  it.each(["COMPLETED", "PARTIAL", "AMBIGUOUS", "UNRESOLVED", "FAILED", "CANCELLED"])("retains ordinary %s status with an empty analysis component", status => {
    const base = example("empty");
    base.status = status;
    const result = assemble(base);
    expect(result.status).toBe(status);
    expect(result.worldAnalysisFindings.findings).toEqual([]);
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(result.resultHash).toBe(worldAnalysisResultHash(result));
    expect(result.execution.runFingerprint).toBe(`sha256:${"b".repeat(64)}`);
  });

  it("exposes only approved reference and evidence fields, with hashed snapshots", () => {
    const base = example("trace");
    for (const reference of base.referenceProducts) reference.safeSummary = { privateField: "never-public" };
    for (const evidence of base.evidenceItems) {
      evidence.safePayload = { originalText: "never-public" };
      evidence.payloadRef = "private://never-public";
      evidence.dataSnapshot = { privateToken: "never-public", capturedAt: "2026-09-06T00:00:00Z" };
    }
    const result = assemble(base);
    expect(JSON.stringify(result)).not.toContain("never-public");
    expect(result.evidenceItems[0]?.dataSnapshot?.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(validate("result", result)).toEqual({ valid: true, errors: [] });
    expect(base.evidenceItems[0].safePayload).toEqual({ originalText: "never-public" });
  });
});
