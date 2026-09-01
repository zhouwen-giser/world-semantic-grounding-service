import { describe, expect, it } from "vitest";

import {
  StructuredSelectionError,
  StructuredSelectionTokenCodec,
  StructuredWorldSelectionResolver,
  type PriorGroundingResult,
  type ResolveWorldSelectionRequest,
  type StructuredSelectionIdentity
} from "./index.js";

const sourceHash = `sha256:${"a".repeat(64)}`;
const resultHash = `sha256:${"b".repeat(64)}`;
const authHash = `sha256:${"c".repeat(64)}`;
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const identity: StructuredSelectionIdentity = {
  servicePrincipalId: "sacs-service",
  actorId: "actor-1",
  dataScope: "scope-gdps",
  authorizationContextHash: authHash
};
const request: ResolveWorldSelectionRequest = {
  schemaVersion: "wsgs-structured-selection-request/1.0",
  priorGroundingId: "grounding-1",
  priorResultHash: resultHash,
  findingId: "finding-1",
  featureId: "feature-1",
  selectionRevision: 1,
  sourceHash
};

function prior(feature: Record<string, unknown>): PriorGroundingResult {
  return {
    groundingId: "grounding-1",
    resultHash,
    geospatialFindings: {
      findings: [{
        findingId: "finding-1",
        sourceProductIds: ["source-1"],
        features: [{ featureId: "feature-1", ...feature }]
      }],
      sourceProducts: [{ sourceProductId: "source-1", contentHash: sourceHash }]
    }
  };
}

function setup(now = 1_800_000_000_000): { codec: StructuredSelectionTokenCodec; resolver: StructuredWorldSelectionResolver } {
  const clock = () => now;
  const codec = new StructuredSelectionTokenCodec({
    activeKeyId: "k2",
    keys: [
      { keyId: "k1", key: Uint8Array.from(key, (value) => value ^ 0x55) },
      { keyId: "k2", key }
    ],
    ttlMs: 300_000,
    now: clock,
    randomBytes: (size) => new Uint8Array(size).fill(7)
  });
  return { codec, resolver: new StructuredWorldSelectionResolver(codec, clock) };
}

function code(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof StructuredSelectionError ? error.code : undefined;
  }
}

describe("structured world selection", () => {
  it("returns an upstream ReferenceKey without also issuing a token", () => {
    const { resolver } = setup();
    const result = resolver.resolve({
      identity,
      request,
      priorResult: prior({
        referenceKey: {
          namespace: "gowm",
          kind: "WORLD_OBJECT",
          id: `wrf_${"d".repeat(32)}`,
          version: "1.0.0"
        }
      })
    });
    expect(result.referenceKey).toMatchObject({ namespace: "gowm", kind: "WORLD_OBJECT" });
    expect(result).not.toHaveProperty("upstreamSelectionToken");
  });

  it("issues an opaque encrypted token and verifies every authority/content binding", () => {
    const { resolver } = setup();
    const result = resolver.resolve({ identity, request, priorResult: prior({ geometry: { type: "Point" } }) });
    expect(result.upstreamSelectionToken).toMatch(/^wsgs\.sel\.v1\.k2\./u);
    expect(result.upstreamSelectionToken).not.toContain("grounding-1");
    expect(JSON.stringify(result)).not.toContain("sacs-service");
    const claims = resolver.verify({ identity, token: result.upstreamSelectionToken!, expected: request });
    expect(claims).toMatchObject({
      selectionId: result.selectionId,
      priorGroundingId: request.priorGroundingId,
      findingId: request.findingId,
      featureId: request.featureId,
      sourceHash
    });
  });

  it("fails closed for prior-result, membership, source, revision and current-source drift", () => {
    const { resolver } = setup();
    expect(code(() => resolver.resolve({ identity, request: { ...request, priorResultHash: `sha256:${"e".repeat(64)}` }, priorResult: prior({ geometry: {} }) })))
      .toBe("SELECTION_RESULT_HASH_MISMATCH");
    expect(code(() => resolver.resolve({ identity, request: { ...request, featureId: "foreign" }, priorResult: prior({ geometry: {} }) })))
      .toBe("SELECTION_NOT_FOUND");
    expect(code(() => resolver.resolve({ identity, request: { ...request, sourceHash: `sha256:${"f".repeat(64)}` }, priorResult: prior({ geometry: {} }) })))
      .toBe("SELECTION_SOURCE_HASH_MISMATCH");
    expect(code(() => resolver.resolve({ identity, request, priorResult: prior({ geometry: {} }), latestSelectionRevision: 1 })))
      .toBe("SELECTION_REVISION_CONFLICT");
    expect(code(() => resolver.resolve({ identity, request, priorResult: prior({ geometry: {} }), currentSourceHash: `sha256:${"f".repeat(64)}` })))
      .toBe("SELECTION_REFERENCE_STALE");
  });

  it("rejects tamper, foreign identity, expiry and post-issuance source drift", () => {
    const { resolver } = setup();
    const result = resolver.resolve({ identity, request, priorResult: prior({ geometry: {} }) });
    const token = result.upstreamSelectionToken!;
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(code(() => resolver.verify({ identity, token: tampered }))).toBe("SELECTION_TOKEN_INVALID");
    expect(code(() => resolver.verify({ identity: { ...identity, dataScope: "foreign" }, token })))
      .toBe("SELECTION_SCOPE_MISMATCH");
    const expired = setup(1_800_000_300_001).resolver;
    expect(code(() => expired.verify({ identity, token }))).toBe("SELECTION_TOKEN_EXPIRED");
    expect(code(() => resolver.verify({ identity, token, currentSourceHash: `sha256:${"0".repeat(64)}` })))
      .toBe("SELECTION_REFERENCE_STALE");
  });

  it("verifies tokens after a process restart and while the signing key is retained for rotation", () => {
    const first = setup();
    const token = first.resolver.resolve({ identity, request, priorResult: prior({ geometry: {} }) }).upstreamSelectionToken!;
    const restarted = setup();
    expect(restarted.resolver.verify({ identity, token }).selectionId).toMatch(/^selection-[0-9a-f]{64}$/u);
  });
});
