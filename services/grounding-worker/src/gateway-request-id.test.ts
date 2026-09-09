import { describe, expect, it } from "vitest";
import { gatewayRequestId } from "./gateway-request-id.js";
import { GowmConsumerSchemaRegistry } from "@wsgs/gowm-contract-intake";
describe("northbound correlation identifier adaptation", () => {
  it("keeps valid IDs and deterministically maps UUID, Unicode and long IDs", () => {
    expect(gatewayRequestId("request-1")).toBe("request-1");
    const registry = new GowmConsumerSchemaRegistry();
    for (const id of ["2e04-uuid", "请求一", "a".repeat(300)]) {
      const mapped = gatewayRequestId(id);
      expect(mapped).toMatch(/^[A-Za-z][A-Za-z0-9._:-]{0,255}$/u);
      expect(mapped).toBe(gatewayRequestId(id));
      expect(mapped).not.toBe(gatewayRequestId(id + "x"));
      expect(() => registry.validate("platform/gateway-execute-request.schema.json", {
        requestVersion: "1.0", requestId: mapped, idempotencyKey: "key", operationVersion: "1.0",
        inputSchemaHash: `sha256:${"a".repeat(64)}`, outputSchemaHash: `sha256:${"b".repeat(64)}`,
        input: {}, executionPolicy: { deadlineAt: "2026-09-07T12:00:00Z", maximumResultBytes: 1024, maximumCostClass: "LOW" }
      })).not.toThrow();
    }
  });
});
