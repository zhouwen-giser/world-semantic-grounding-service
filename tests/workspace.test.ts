import { describe, expect, it } from "vitest";

import {
  GOWM_COMMIT,
  GOWM_VERSION,
  WSGS_CONTRACT_VERSION,
  WSGS_VERSION
} from "../packages/contracts/src/index.js";

describe("workspace baseline", () => {
  it("pins the service and contract versions", () => {
    expect(WSGS_VERSION).toBe("0.1.0");
    expect(WSGS_CONTRACT_VERSION).toBe("sacs-wsgs-grounding/1.0");
    expect(GOWM_VERSION).toBe("0.6.3");
    expect(GOWM_COMMIT).toBe("17dd221330d9af540ec815a39eca96550690299a");
  });
});

