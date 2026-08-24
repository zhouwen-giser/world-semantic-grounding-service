import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ContextLoadError, PriorContextLoader, type ContextCapsuleInput } from "./index.js";

const result = {
  schemaVersion: "1.0",
  groundingId: "grounding-1",
  referenceProducts: [{
    productId: "product-1",
    productKind: "RESOLVED_REFERENCE",
    validUntil: "2026-08-24T00:00:00Z",
    revalidationRequired: false,
    referenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: `wrf_${"1".repeat(32)}`, version: "v1" }
  }],
  evidenceItems: []
};
const bytes = new TextEncoder().encode(JSON.stringify(result));
const resultHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;

function capsule(): ContextCapsuleInput {
  return {
    knownWorldReferences: [],
    priorGroundings: [{ groundingId: "grounding-1", resultHash, selectedProductIds: ["product-1"] }],
    mapSelections: [],
    externalCorrelationHints: [],
    externalPredicates: []
  };
}

function loader(scope = "scope-a", maximumCapsuleBytes?: number): PriorContextLoader {
  return new PriorContextLoader({
    resultStore: {
      getResult: vi.fn(async (requestedScope, groundingId) =>
        requestedScope === scope && groundingId === "grounding-1" ? bytes : null)
    },
    mapRevisions: { currentRevision: vi.fn(async (_scope, selectionId) => selectionId === "map-current" ? 2 : selectionId === "map-stale" ? 3 : null) },
    ...(maximumCapsuleBytes === undefined ? {} : { maximumCapsuleBytes }),
    now: () => new Date("2026-08-25T00:00:00Z")
  });
}

describe("PriorContextLoader", () => {
  it("loads only selected server-side products after an exact result hash match", async () => {
    const loaded = await loader().load("scope-a", capsule());
    expect(loaded.priorProducts).toHaveLength(1);
    expect(loaded.priorProducts[0]).toMatchObject({
      sourceGroundingId: "grounding-1",
      sourceResultHash: resultHash,
      productId: "product-1",
      productKind: "RESOLVED_REFERENCE",
      revalidationRequired: true
    });
    expect(loaded.warnings).toContain("PRIOR_PRODUCT_REVALIDATION_REQUIRED:product-1");
  });

  it("cannot load a prior result from another data scope", async () => {
    await expect(loader().load("scope-b", capsule())).rejects.toMatchObject({
      code: "PRIOR_RESULT_NOT_FOUND_IN_SCOPE",
      httpStatus: 404
    });
  });

  it("rejects caller-substituted prior content and a mismatched hash", async () => {
    const substituted = capsule() as unknown as Record<string, unknown>;
    ((substituted["priorGroundings"] as Record<string, unknown>[])[0]!)["result"] = result;
    await expect(loader().load("scope-a", substituted)).rejects.toMatchObject({ code: "PRIOR_CONTENT_SUBSTITUTION_FORBIDDEN" });

    const mismatch = capsule();
    mismatch.priorGroundings[0]!.resultHash = `sha256:${"0".repeat(64)}`;
    await expect(loader().load("scope-a", mismatch)).rejects.toMatchObject({ code: "PRIOR_RESULT_HASH_MISMATCH", httpStatus: 409 });
  });

  it("rejects full conversation history and oversized capsules", async () => {
    const history = { ...capsule(), conversationHistory: [{ role: "user", content: "secret" }] };
    await expect(loader().load("scope-a", history)).rejects.toMatchObject({ code: "UNKNOWN_CONTEXT_FIELD" });
    const huge = capsule();
    huge.externalCorrelationHints = [{ hintId: "hint", externalAuthority: "x", kind: "EXTERNAL_TASK", value: "x".repeat(2_000) }];
    await expect(loader("scope-a", 512).load("scope-a", huge)).rejects.toMatchObject({ code: "CONTEXT_TOO_LARGE", httpStatus: 413 });
  });

  it("detects current, stale, and missing map revisions without overwriting caller data", async () => {
    const input = capsule();
    input.priorGroundings = [];
    input.mapSelections = [
      { selectionId: "map-current", kind: "AREA", revision: 2 },
      { selectionId: "map-stale", kind: "AREA", revision: 2 },
      { selectionId: "map-missing", kind: "AREA", revision: 1 }
    ];
    const loaded = await loader().load("scope-a", input);
    expect(loaded.mapSelections.map((entry) => entry.revisionStatus)).toEqual(["CURRENT", "STALE", "NOT_FOUND"]);
    expect(loaded.warnings).toEqual(expect.arrayContaining([
      "MAP_REVISION_STALE:map-stale", "MAP_REVISION_NOT_FOUND:map-missing"
    ]));
  });

  it("marks expired KnownReference values for mandatory revalidation", async () => {
    const input = capsule();
    input.priorGroundings = [];
    input.knownWorldReferences = [{
      alias: "old object",
      validUntil: "2026-08-24T00:00:00Z",
      referenceKey: { namespace: "gowm", kind: "WORLD_OBJECT", id: `wrf_${"2".repeat(32)}`, version: "v1" },
      referenceType: "OBJECT",
      sourceMessageId: "message-1"
    }];
    const loaded = await loader().load("scope-a", input);
    expect(loaded.knownWorldReferences[0]).toMatchObject({ alias: "old object", revalidationRequired: true });
  });

  it("rejects selected product IDs absent from the retained server result", async () => {
    const input = capsule();
    input.priorGroundings[0]!.selectedProductIds = ["fabricated-product"];
    const failure = await loader().load("scope-a", input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ContextLoadError);
    expect((failure as ContextLoadError).code).toBe("SELECTED_PRIOR_PRODUCT_NOT_FOUND");
  });
});
