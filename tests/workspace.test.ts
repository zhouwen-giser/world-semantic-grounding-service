import { describe, expect, it } from "vitest";

import { GOWM_COMMIT, WSGS_CONTRACT_VERSION, WSGS_VERSION } from "../packages/contracts/src/index.js";

describe("workspace baseline", () => {
  it("pins the service and contract versions", () => {
    expect(WSGS_VERSION).toBe("0.1.0");
    expect(WSGS_CONTRACT_VERSION).toBe("sacs-wsgs-grounding/1.0");
    expect(GOWM_COMMIT).toBe("db575f79c874a69f65a2043a7e463338524b713d");
  });
});

