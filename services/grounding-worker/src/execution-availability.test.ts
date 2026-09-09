import { describe, expect, it } from "vitest";
import { analysisHash } from "@wsgs/gowm-contract-intake";
import { advancedCompileFixture } from "../../../packages/query-compiler/src/advanced-test-fixtures.js";
import { executionAvailabilityObservation, validateExecutionAvailability } from "./execution-availability.js";

function fixture() {
  const compiled = advancedCompileFixture();
  return { operationIds: [compiled.operationLocks[0]!.operationId], locks: compiled.operationLocks,
    permissions: ["analysis:read"], catalogRevision: "sha256:test", bindingRevision: "sha256:test",
    observedAt: new Date().toISOString(), operations: compiled.availability };
}
describe("execution health observations preserve admitted authority", () => {
  it("copies a fresh observation without changing frozen metadata and hashes its identity binding", () => {
    const input = fixture(), original = structuredClone(input);
    const operations = validateExecutionAvailability(input);
    expect(input).toEqual(original);
    expect(operations[0]).not.toBe(input.operations[0]);
    const observation = executionAvailabilityObservation({ operations, requestId: "request",
      observedAt: input.observedAt, authorityHash: analysisHash("authority"), principalHash: analysisHash("principal"),
      delegationHash: analysisHash("delegation") });
    const { observationHash, ...body } = observation;
    expect(observationHash).toBe(analysisHash(body));
    expect(executionAvailabilityObservation({ ...body, principalHash: analysisHash("other") }).observationHash).not.toBe(observationHash);
  });
  it.each(["catalog", "binding", "version", "maturity", "missing", "duplicate", "permission", "expired", "future", "invalid"])("rejects %s", kind => {
    const input = fixture(), entry = input.operations[0]!;
    if (kind === "catalog") entry.contractCatalogRevision = "sha256:other";
    if (kind === "binding") entry.bindingRevision = "sha256:other";
    if (kind === "version") entry.operationVersion = "999";
    if (kind === "maturity") entry.maturity = "STABLE";
    if (kind === "missing") input.operations = [];
    if (kind === "duplicate") input.operations.push(structuredClone(entry));
    if (kind === "permission") input.permissions = [];
    if (kind === "expired") entry.validUntil = input.observedAt;
    if (kind === "future") entry.checkedAt = new Date(Date.now() + 60000).toISOString();
    if (kind === "invalid") input.observedAt = "invalid";
    expect(() => validateExecutionAvailability(input)).toThrow(/HISTORICAL_AVAILABILITY/);
  });
});
