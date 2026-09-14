import { expect, it, vi } from "vitest";
import { loadGatewayAvailability } from "./gateway-availability.js";

it("queries each locked operation once with the same authority and preserves freshness metadata", async () => {
  const entry = { checkedAt: "2026-09-09T00:00:00Z", validUntil: "2026-09-09T00:00:05Z", availability: "UNAVAILABLE" };
  const gateway = { listOperationAvailability: vi.fn(), getOperationAvailability: vi.fn().mockResolvedValue(entry) };
  const operation = { operationId: "reference.get", operationVersion: "1.0" };
  const context = { delegationToken: "test-token", deadlineAt: new Date() };
  const result = await loadGatewayAvailability(gateway, [operation, operation], context, { GOWM_AVAILABILITY_MODE: "REQUIRED_OPERATIONS" });
  expect(gateway.listOperationAvailability).not.toHaveBeenCalled();
  expect(gateway.getOperationAvailability).toHaveBeenCalledExactlyOnceWith("reference.get", "1.0", context);
  expect(result.operations[0]).toBe(entry);
});

it("keeps full discovery by default and propagates upstream failures", async () => {
  const gateway = { listOperationAvailability: vi.fn().mockResolvedValue({ operations: [] }), getOperationAvailability: vi.fn().mockRejectedValue(new Error("upstream unavailable")) };
  expect(await loadGatewayAvailability(gateway, [], {}, {})).toEqual({ operations: [] });
  await expect(loadGatewayAvailability(gateway, [{ operationId: "reference.get", operationVersion: "1.0" }], {}, { GOWM_AVAILABILITY_MODE: "REQUIRED_OPERATIONS" })).rejects.toThrow("upstream unavailable");
  await expect(loadGatewayAvailability(gateway, [], {}, { GOWM_AVAILABILITY_MODE: "invalid" })).rejects.toThrow("GOWM_AVAILABILITY_MODE");
});
