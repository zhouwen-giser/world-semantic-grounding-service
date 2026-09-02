import { describe, expect, it } from "vitest";

import { StructuredSelectionError } from "@wsgs/structured-world-selection";

import { structuredSelectionTokenMetadata } from "./postgres-selection-store.js";

describe("structured selection persistence metadata", () => {
  it("persists only a bounded key id and digest, never raw token material", () => {
    const token = "wsgs.sel.v1.selection-key.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBB.CCCCCCCCCCCCCCCC";
    const metadata = structuredSelectionTokenMetadata(token);
    expect(metadata).toEqual({
      keyId: "selection-key",
      tokenHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    });
    expect(JSON.stringify(metadata)).not.toContain(token);
  });

  it("rejects malformed token envelopes before persistence", () => {
    expect(() => structuredSelectionTokenMetadata("not-a-selection-token"))
      .toThrowError(StructuredSelectionError);
  });
});
