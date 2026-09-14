import { worldAnalysisCanonicalHash, type GroundingResult12 } from "@wsgs/contracts";
import type { ReferenceGroundingResult, ReferenceValidationProduct } from "@wsgs/grounding-graph";
import { sameReferenceIdentity, type HistoricalExecutionResult } from "@wsgs/historical-trace-consumer";
import { referenceValidationLease } from "./reference-validation-lease.js";

type Product = GroundingResult12["referenceProducts"][number] & { safeSummary?: Record<string, unknown> };
type Key = Product["referenceKey"];
export type HistoricalSubjectAdmission =
  | { status: "ADMITTED"; product: Product; validation: ReferenceValidationProduct }
  | { status: "REJECTED"; reasonCode: "REFERENCE_MISSING" | "SUBJECT_TASK_MISMATCH" };

/** Only fresh, server-resolved task context may admit an indirect subject. */
export async function admitHistoricalSubject(input: {
  execution: HistoricalExecutionResult;
  references: Pick<ReferenceGroundingResult, "referenceProducts" | "validationResults">;
  resolve: (key: Key, attempt: number) => Promise<{ referenceKey: Key; referenceType: string; displayName: string; sourceWorldVersion: number; stale: boolean }>;
  validate: (key: Key, attempt: number) => Promise<ReferenceValidationProduct>;
  validityTtlMs: number;
  now?: () => number;
}): Promise<HistoricalSubjectAdmission> {
  const now = input.now ?? Date.now;
  const context = input.execution.context;
  const subject = context?.subjectReferenceKey;
  const finding = input.execution.finding;
  const rejected = { status: "REJECTED", reasonCode: "REFERENCE_MISSING" } as const;
  if (!subject || subject.namespace !== "gowm" || subject.kind !== "WORLD_OBJECT" || !finding?.subjectReferenceKey ||
      !sameReferenceIdentity(subject, finding.subjectReferenceKey)) return rejected;
  if (!context.taskSnapshot || !sameReferenceIdentity(context.taskReferenceKey, context.taskSnapshot.referenceKey) ||
      !finding.taskReferenceKey || !sameReferenceIdentity(finding.taskReferenceKey, context.taskReferenceKey) ||
      !context.taskSnapshot.actorReferenceKeys.some(actor => sameReferenceIdentity(actor, subject))) {
    return { status: "REJECTED", reasonCode: "SUBJECT_TASK_MISMATCH" };
  }
  const exact = (key: Key) => worldAnalysisCanonicalHash(key) === worldAnalysisCanonicalHash(subject);
  const existing = input.references.referenceProducts.find(product => exact(product.referenceKey) &&
    product.revalidationRequired === false && product.validUntil && Date.parse(product.validUntil) > now());
  const existingValidation = input.references.validationResults.find(v => exact(v.referenceKey) && v.status === "VALID" && !v.revalidationRequired);
  if (existing && existingValidation) {
    return { status: "ADMITTED", product: existing, validation: existingValidation };
  }
  let key: Key = { ...subject, namespace: "gowm" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const descriptor = await input.resolve(key, attempt);
    key = descriptor.referenceKey;
    if (!sameReferenceIdentity(key, subject) || typeof key.version !== "string" || !key.version ||
        !descriptor.referenceType || !descriptor.displayName || !Number.isSafeInteger(descriptor.sourceWorldVersion) || descriptor.sourceWorldVersion < 0) return rejected;
    if (descriptor.stale) continue;
    const validation = await input.validate(key, attempt);
    if (worldAnalysisCanonicalHash(validation.referenceKey) !== worldAnalysisCanonicalHash(key)) return rejected;
    if (validation.status === "STALE") continue;
    if (validation.status !== "VALID" || validation.revalidationRequired) return rejected;
    const lease = referenceValidationLease(validation, new Date(now()).toISOString(), input.validityTtlMs);
    const previous = input.references.referenceProducts.find(p => worldAnalysisCanonicalHash(p.referenceKey) === worldAnalysisCanonicalHash(key));
    return { status: "ADMITTED", validation, product: {
      productId: previous?.productId ?? `history-subject-${worldAnalysisCanonicalHash(key).slice(7, 31)}`,
      productKind: "DERIVED_REFERENCE", referenceKey: key, referenceType: descriptor.referenceType,
      displayName: descriptor.displayName, sourceOperation: "VALIDATE_REFERENCES", sourceWorldVersion: descriptor.sourceWorldVersion,
      revalidationRequired: lease.revalidationRequired, ...(lease.validUntil ? { validUntil: lease.validUntil } : {}),
      safeSummary: { ...lease.validationSummary, descriptorSourceOperation: "reference.get", relationshipSourceOperation: "operational-task.get" }
    } };
  }
  return rejected;
}
