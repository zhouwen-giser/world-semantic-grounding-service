import { analysisHash } from "@wsgs/gowm-contract-intake";
import type { OperationAvailability, OperationLock } from "@wsgs/gowm-gateway-client";

export class ExecutionAvailabilityError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** A new health observation may not replace the admitted contract or grants. */
export function validateExecutionAvailability(input: {
  operationIds: readonly string[]; locks: readonly OperationLock[]; permissions: readonly string[];
  catalogRevision: string; bindingRevision: string; observedAt: string;
  operations: readonly OperationAvailability[];
}): OperationAvailability[] {
  const now = Date.parse(input.observedAt);
  if (!Number.isFinite(now)) throw new ExecutionAvailabilityError("HISTORICAL_AVAILABILITY_TIME_INVALID");
  return input.operationIds.map(id => {
    const locks = input.locks.filter(lock => lock.operationId === id);
    if (locks.length !== 1 || (locks[0]!.requiredPermissions ?? []).some(permission => !input.permissions.includes(permission))) {
      throw new ExecutionAvailabilityError("HISTORICAL_AVAILABILITY_AUTHORITY_MISMATCH");
    }
    const lock = locks[0]!;
    const entries = input.operations.filter(entry => entry.operationId === id && entry.operationVersion === lock.operationVersion);
    if (entries.length !== 1) throw new ExecutionAvailabilityError("HISTORICAL_AVAILABILITY_OPERATION_MISSING");
    const entry = entries[0]!;
    if (entry.contractCatalogRevision !== input.catalogRevision || entry.bindingRevision !== input.bindingRevision || entry.maturity !== lock.maturity) {
      throw new ExecutionAvailabilityError("HISTORICAL_AVAILABILITY_CONTRACT_MISMATCH");
    }
    const checked = Date.parse(entry.checkedAt), expires = Date.parse(entry.validUntil);
    if (!Number.isFinite(checked) || !Number.isFinite(expires) || checked > now || expires <= now || expires <= checked) {
      throw new ExecutionAvailabilityError("HISTORICAL_AVAILABILITY_EXPIRED");
    }
    return structuredClone(entry);
  });
}

export function executionAvailabilityObservation(input: {
  requestId: string; observedAt: string; authorityHash: string; principalHash: string; delegationHash: string;
  operations: OperationAvailability[];
}) {
  const body = { schemaVersion: "1.0" as const, kind: "EXECUTION_AVAILABILITY" as const, ...input };
  return { ...body, observationHash: analysisHash(body) };
}
