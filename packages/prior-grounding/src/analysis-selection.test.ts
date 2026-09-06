import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveStoredAnalysisSelection, type StoredPriorAnalysis } from "./validator.js";
import type { PriorGroundingIdentity } from "./types.js";

const example = (name: string) => JSON.parse(readFileSync(new URL(`../../../contracts/wsgs-v0.2.4-world-analysis/examples/${name}.json`, import.meta.url), "utf8"));
const identity: PriorGroundingIdentity = { servicePrincipalId: "sacs", actorId: "actor", dataScopes: ["scope"], datasetScopes: ["dataset"], permissions: ["grounding.read"], authorizationContextHash: `sha256:${"a".repeat(64)}` };
function fixture() {
  const request = example("request-selection");
  const result = example("ranking");
  const stored: StoredPriorAnalysis = { groundingId: result.groundingId, servicePrincipalId: identity.servicePrincipalId, actorId: identity.actorId,
    dataScope: "scope", datasetScopes: identity.datasetScopes, authorizationContextHash: identity.authorizationContextHash,
    resultHash: result.resultHash, resultBytes: Buffer.from(JSON.stringify(result)), expiresAt: "2026-09-06T02:00:59Z" };
  return { identity, dataScope: "scope", pointer: request.contextCapsule.priorGroundings[0], selection: request.analysisSelections[0], stored, now: new Date("2026-09-06T02:00:01Z") };
}

describe("stored 1.2 analysis selection authority", () => {
  it("infers an ordinal only from one authenticated stored Choice", () => {
    const { selection: _selection, ...input } = fixture();
    expect(resolveStoredAnalysisSelection({ ...input, ordinal: 2 }).candidate).toMatchObject({ candidateId: "candidate-2", rank: 2 });
    expect(() => resolveStoredAnalysisSelection({ ...input, ordinal: 100 })).toThrow("SELECTION_INVALID");
    input.stored.resultBytes = Buffer.from(JSON.stringify({ ...example("ranking"), warnings: ["tampered"] }));
    expect(() => resolveStoredAnalysisSelection({ ...input, ordinal: 2 })).toThrow("SELECTION_INVALID");
  });
  it("clarifies multiple saved Choices rather than choosing one by position", () => {
    const { selection: _selection, ...input } = fixture();
    const result = example("all-choices");
    input.stored.resultBytes = Buffer.from(JSON.stringify(result));
    input.stored.resultHash = result.resultHash;
    input.pointer.resultHash = result.resultHash;
    expect(() => resolveStoredAnalysisSelection({ ...input, ordinal: 2 })).toThrow("SELECTION_AMBIGUOUS");
  });
  it("rejects conflicting ordinal and explicit candidate", () => {
    expect(() => resolveStoredAnalysisSelection({ ...fixture(), ordinal: 1 })).toThrow("SELECTION_AMBIGUOUS");
  });
  it.each([0, -1, 101, 1.5, NaN])("rejects invalid ordinal %s", ordinal => {
    const { selection: _selection, ...input } = fixture();
    expect(() => resolveStoredAnalysisSelection({ ...input, ordinal })).toThrow("SELECTION_INVALID");
  });
  it("resolves a saved rank candidate without requiring a fake ReferenceProduct", () => {
    const input = fixture();
    const resolved = resolveStoredAnalysisSelection(input);
    expect(input.pointer.selectedProductIds).toEqual([]);
    expect(resolved.choice.choiceKind).toBe("RANKED_LOCATION_SELECTION");
    expect(resolved.candidate).toMatchObject({ candidateId: "candidate-2", rank: 2 });
  });
  it.each(["actorId", "servicePrincipalId", "dataScope", "authorizationContextHash"] as const)("refuses mismatched stored %s", field => {
    const input = fixture(); input.stored[field] = "foreign";
    expect(() => resolveStoredAnalysisSelection(input)).toThrow("PRIOR_RESULT_NOT_FOUND_IN_SCOPE");
  });
  it("checks dataset scope independently", () => {
    const input = fixture(); input.stored.datasetScopes = ["foreign"];
    expect(() => resolveStoredAnalysisSelection(input)).toThrow("PRIOR_RESULT_NOT_FOUND_IN_SCOPE");
  });
  it.each(["candidateId", "choiceId", "findingSetHash", "priorResultHash"])("rejects tampered %s", field => {
    const input = fixture(); input.selection[field] = field.endsWith("Hash") ? `sha256:${"b".repeat(64)}` : "forged";
    expect(() => resolveStoredAnalysisSelection(input)).toThrow("SELECTION_INVALID");
  });
  it.each(["coordinate", "rank", "safeSummary", "displayName"])("does not accept client-supplied %s", field => {
    const input = fixture(); input.selection[field] = "forged";
    expect(() => resolveStoredAnalysisSelection(input)).toThrow("SELECTION_INVALID");
  });
  it("verifies saved result content using its public hash rather than a raw-byte hash", () => {
    const input = fixture();
    const result = JSON.parse(Buffer.from(input.stored.resultBytes).toString());
    input.stored.resultBytes = Buffer.from(JSON.stringify(result, null, 2));
    expect(() => resolveStoredAnalysisSelection(input)).not.toThrow();
    result.warnings.push("tampered");
    input.stored.resultBytes = Buffer.from(JSON.stringify(result));
    expect(() => resolveStoredAnalysisSelection(input)).toThrow("SELECTION_INVALID");
  });
  it("expires the server retention deadline and the public choice deadline independently", () => {
    const expired = fixture(); expired.stored.expiresAt = "2026-09-06T02:00:00Z";
    expect(() => resolveStoredAnalysisSelection(expired)).toThrow("SELECTION_EXPIRED");
    const choice = fixture(); choice.stored.expiresAt = "2027-01-01T00:00:00Z"; choice.now = new Date("2026-09-07T00:00:00Z");
    expect(() => resolveStoredAnalysisSelection(choice)).toThrow("SELECTION_EXPIRED");
  });
  it("rejects analysis candidate IDs in selectedProductIds", () => {
    const input = fixture(); input.pointer.selectedProductIds = [input.selection.candidateId];
    expect(() => resolveStoredAnalysisSelection(input)).toThrow("INVALID_SELECTED_PRODUCT_IDS");
  });
});
