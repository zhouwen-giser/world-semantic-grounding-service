import { describe, expect, it } from "vitest";

import { primaryDataScopeFromEnvironment } from "./production.js";

describe("primaryDataScopeFromEnvironment", () => {
  it("preserves the legacy selector when no primary scope is configured", () => {
    expect(primaryDataScopeFromEnvironment({})).toBeUndefined();
  });

  it("accepts one exact server-owned primary scope", () => {
    expect(primaryDataScopeFromEnvironment({
      WSGS_PRIMARY_DATA_SCOPE: "scope-gdps-v021-baseline"
    })).toBe("scope-gdps-v021-baseline");
  });

  it.each(["", " scope-a", "scope-a ", "*", "scope-*"])(
    "rejects an invalid or wildcard primary scope %j",
    (value) => {
      expect(() => primaryDataScopeFromEnvironment({ WSGS_PRIMARY_DATA_SCOPE: value })).toThrow(
        "WSGS_PRIMARY_DATA_SCOPE"
      );
    }
  );
});
