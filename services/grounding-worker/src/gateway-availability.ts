import type { GatewayRequestContext, GowmGatewayClient, OperationAvailabilityList } from "@wsgs/gowm-gateway-client";

/** Limit discovery to the consumer's locked operations on a shared static-service gateway. */
export async function loadGatewayAvailability(
  gateway: Pick<GowmGatewayClient, "listOperationAvailability" | "getOperationAvailability">,
  operations: readonly { operationId: string; operationVersion: string }[],
  context: GatewayRequestContext,
  environment: NodeJS.ProcessEnv = process.env
): Promise<OperationAvailabilityList> {
  const mode = environment["GOWM_AVAILABILITY_MODE"] ?? "ALL_OPERATIONS";
  if (mode === "ALL_OPERATIONS") return gateway.listOperationAvailability(context);
  if (mode !== "REQUIRED_OPERATIONS") throw new Error("GOWM_AVAILABILITY_MODE must be ALL_OPERATIONS or REQUIRED_OPERATIONS");
  const entries: OperationAvailabilityList["operations"] = [];
  const seen = new Set<string>();
  // Sequential calls avoid bursting every Provider health check at once. The same deadline
  // and delegated identity apply to every call; original expiry timestamps remain intact.
  for (const operation of operations) {
    const key = `${operation.operationId}@${operation.operationVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(await gateway.getOperationAvailability(operation.operationId, operation.operationVersion, context));
  }
  return { schemaVersion: "1.0", checkedAt: new Date().toISOString(), operations: entries };
}
