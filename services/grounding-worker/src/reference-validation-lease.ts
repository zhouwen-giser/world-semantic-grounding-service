import type { ReferenceValidationProduct } from "@wsgs/grounding-graph";

export function referenceValidationLease(validation: ReferenceValidationProduct, evaluatedAt: string, ttlMs: number) {
  const timestamp = Date.parse(evaluatedAt);
  if (!Number.isFinite(timestamp) || !Number.isInteger(ttlMs) || ttlMs < 1) throw new Error("REFERENCE_VALIDATION_LEASE_INVALID");
  const usable = validation.status === "VALID" && !validation.revalidationRequired;
  return {
    revalidationRequired: !usable,
    ...(usable ? { validUntil: new Date(timestamp + ttlMs).toISOString() } : {}),
    validationSummary: { validationStatus: validation.status, validationSourceOperation: "reference.validate",
      validationEvaluatedAt: new Date(timestamp).toISOString(), validitySemantics: "GOWM_REFERENCE_VALIDATE_BOUNDED_LEASE" }
  };
}
