import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentGowmPath, currentGowmRoot } from "./current.js";

describe("current consumer bundle paths", () => {
  it("resolves a bundle member with the host path separator", () => {
    expect(currentGowmPath("bundle/MANIFEST.json")).toBe(join(currentGowmRoot, "bundle", "MANIFEST.json"));
  });
  it.each([".", "..", "../outside.json", "bundle/../../outside.json"])("rejects non-member %s", value => {
    expect(() => currentGowmPath(value)).toThrow("CURRENT_GOWM_PATH_INVALID");
  });
});
