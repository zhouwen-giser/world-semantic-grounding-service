import { describe, expect, it } from "vitest";

import {
  GOWM_CONSUMER_PACKAGE_VERSION,
  GOWM_GATEWAY_CONTRACT_VERSION,
  GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK,
  GOWM_RUNTIME_SOURCE_COMMIT,
  GOWM_RUNTIME_VERSION,
  WSGS_CONTRACT_VERSION,
  WSGS_LEGACY_CONTRACT_VERSION,
  WSGS_VERSION
} from "../packages/contracts/src/index.js";

describe("workspace baseline", () => {
  it("pins the service and contract versions", () => {
    expect(WSGS_VERSION).toBe("0.2.1");
    expect(WSGS_CONTRACT_VERSION).toBe("sacs-wsgs-grounding/1.1");
    expect(WSGS_LEGACY_CONTRACT_VERSION).toBe("sacs-wsgs-grounding/1.0");
    expect(GOWM_RUNTIME_SOURCE_COMMIT).toBe("c49bf415fdb4cbe19a09f341c34b6dd825e3ca14");
    expect(GOWM_RUNTIME_VERSION).toBe("0.6.4");
    expect(GOWM_GATEWAY_CONTRACT_VERSION).toBe("0.6.3");
    expect(GOWM_CONSUMER_PACKAGE_VERSION).toBe("0.6.3");
    expect(GOWM_RUNTIME_VERSION).not.toBe(GOWM_GATEWAY_CONTRACT_VERSION);
    expect(GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK.requiredTuple).toEqual({
      gowmRuntimeVersion: GOWM_RUNTIME_VERSION,
      gatewayContractVersion: GOWM_GATEWAY_CONTRACT_VERSION,
      gatewayConsumerPackageVersion: GOWM_CONSUMER_PACKAGE_VERSION,
      runtimeAndContractVersionsMustRemainIndependent: true,
      runtimeVersionMustNotBeCopiedIntoContractVersion: true
    });
    expect(Object.isFrozen(GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK)).toBe(true);
    expect(Object.isFrozen(GOWM_RUNTIME_CONTRACT_ALIGNMENT_LOCK.gowmRuntime)).toBe(true);
  });
});

