import { createHash } from "node:crypto";
import type {
  CapabilityGap,
  CapabilityGapReason,
  CapabilityDescriptor,
  CapabilityMatchInput,
  CapabilityMatchResult,
  CapabilityPort,
  CapabilitySemanticProfile,
  MatchedCapability,
  OperationAvailability,
  OperationLock,
  PortRequirement,
  SemanticCapabilityRequirement,
  SnapshotMode
} from "./types.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function canonicalSemanticProfileHash(profile: CapabilitySemanticProfile): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(profile), "utf8").digest("hex")}`;
}

function stableGapId(requirement: SemanticCapabilityRequirement, reason: CapabilityGapReason, details: Record<string, unknown>): string {
  const source = canonical({
    requirementId: requirement.requirementId,
    semanticCapability: requirement.semanticCapability,
    reason,
    details
  });
  return `gap-${createHash("sha256").update(source, "utf8").digest("hex").slice(0, 24)}`;
}

export function capabilityGap(
  requirement: SemanticCapabilityRequirement,
  reason: CapabilityGapReason,
  details: Record<string, unknown>
): CapabilityGap {
  return {
    gapId: stableGapId(requirement, reason, details),
    semanticCapability: requirement.semanticCapability,
    reason,
    requiredForProduct: requirement.requiredForProduct,
    blocking: true,
    details
  };
}

function operationKey(value: { operationId: string; operationVersion: string }): string {
  return `${value.operationId}@${value.operationVersion}`;
}

function containsAll(actual: readonly string[], required: readonly string[]): boolean {
  return required.every((value) => actual.includes(value));
}

function portMatches(actual: CapabilityPort, required: PortRequirement): boolean {
  return actual.name === required.name &&
    actual.valueKind === required.valueKind &&
    actual.unitSemantics === required.unitSemantics &&
    (required.schemaHash === undefined || actual.schemaHash === required.schemaHash);
}

function portsMatch(actual: readonly CapabilityPort[], required: readonly PortRequirement[]): boolean {
  return required.every((port) => actual.some((candidate) => portMatches(candidate, port)));
}

function snapshotSupported(
  mode: SnapshotMode,
  support: OperationLock["snapshotSupport"],
  descriptor: CapabilityDescriptor
): boolean {
  if (support === undefined) return false;
  const worldIndependent =
    descriptor.dataBinding === "WORLD_INDEPENDENT" &&
    descriptor.snapshotPolicy.dataSnapshot === "NONE";
  if (worldIndependent && support === "NONE") return true;
  if (mode === "BEST_EFFORT") return true;
  if (mode === "PINNED") return support === "PINNED";
  return support === "CONSISTENT_AT_START" || support === "PINNED";
}

interface CandidateEvaluation {
  matched?: MatchedCapability;
  candidateForExactVerification?: boolean;
  rejection?: { reason: CapabilityGapReason; details: Record<string, unknown> };
}

function evaluateCandidate(
  input: CapabilityMatchInput,
  lock: OperationLock,
  requirement: SemanticCapabilityRequirement,
  options: { verifier?: boolean } = {}
): CandidateEvaluation {
  const key = operationKey(lock);
  const descriptor = input.capabilities.find((entry) => operationKey(entry) === key);
  const semanticEntry = input.semanticProfiles.find((entry) => operationKey(entry) === key);
  const availability = input.availability.find((entry) => operationKey(entry) === key);
  if (!descriptor || !semanticEntry || !availability) {
    return {
      rejection: {
        reason: "NOT_REGISTERED",
        details: {
          operationKey: key,
          descriptorPresent: descriptor !== undefined,
          semanticProfilePresent: semanticEntry !== undefined,
          availabilityPresent: availability !== undefined
        }
      }
    };
  }

  if (
    descriptor.maturity !== "STABLE" &&
    !(descriptor.maturity === "PREVIEW" && input.maturityPolicy.allowPreview)
  ) {
    return {
      rejection: {
        reason: "MATURITY_NOT_ALLOWED",
        details: { operationKey: key, maturity: descriptor.maturity, previewEnabled: input.maturityPolicy.allowPreview }
      }
    };
  }
  if (
    descriptor.inputSchemaHash !== lock.inputSchemaHash ||
    descriptor.outputSchemaHash !== lock.outputSchemaHash ||
    descriptor.maturity !== lock.maturity
  ) {
    return {
      rejection: {
        reason: "SCHEMA_MISMATCH",
        details: { operationKey: key, layer: "southbound-lock" }
      }
    };
  }
  const profileHash = canonicalSemanticProfileHash(semanticEntry.semanticProfile);
  if (
    lock.semanticProfileHash === undefined ||
    semanticEntry.semanticProfileHash !== lock.semanticProfileHash ||
    profileHash !== lock.semanticProfileHash ||
    (descriptor.semanticProfile !== undefined &&
      canonicalSemanticProfileHash(descriptor.semanticProfile) !== lock.semanticProfileHash)
  ) {
    return {
      rejection: {
        reason: "SEMANTIC_MISMATCH",
        details: { operationKey: key, layer: "semantic-profile-hash" }
      }
    };
  }
  if (!Number.isFinite(Date.parse(input.observedAt)) || !Number.isFinite(Date.parse(availability.checkedAt))) {
    return {
      rejection: {
        reason: "AVAILABILITY_STALE",
        details: { operationKey: key, observedAt: input.observedAt, checkedAt: availability.checkedAt }
      }
    };
  }
  if (availability.validUntil !== undefined && Date.parse(availability.validUntil) < Date.parse(input.observedAt)) {
    return {
      rejection: {
        reason: "AVAILABILITY_STALE",
        details: { operationKey: key, validUntil: availability.validUntil, observedAt: input.observedAt }
      }
    };
  }
  if (availability.availability === "UNAVAILABLE" || availability.availability === "DISABLED") {
    return {
      rejection: {
        reason: "OPERATION_UNAVAILABLE",
        details: { operationKey: key, availability: availability.availability, reasonCodes: availability.reasonCodes }
      }
    };
  }
  if (availability.availability === "DEGRADED" && input.degradedPolicy === "REJECT") {
    return {
      rejection: {
        reason: "OPERATION_DEGRADED",
        details: { operationKey: key, reasonCodes: availability.reasonCodes }
      }
    };
  }
  if (!snapshotSupported(requirement.snapshotMode, lock.snapshotSupport, descriptor)) {
    return {
      rejection: {
        reason: "SNAPSHOT_UNSUPPORTED",
        details: { operationKey: key, requested: requirement.snapshotMode, supported: lock.snapshotSupport }
      }
    };
  }

  const profile = semanticEntry.semanticProfile;
  const candidateForExactVerification =
    !options.verifier &&
    requirement.spatialSemantics === "EXACT" &&
    profile.spatialSemantics === "CANDIDATE" &&
    requirement.allowCandidateWithExactVerification === true;
  const spatialMatch = options.verifier
    ? profile.spatialSemantics === "EXACT"
    : profile.spatialSemantics === requirement.spatialSemantics || candidateForExactVerification;
  const semanticMatch = options.verifier
    ? profile.spatialSemantics === "EXACT" && (profile.resultNature === "FACT" || profile.resultNature === "VALIDATION")
    : profile.domain === requirement.domain &&
      containsAll(profile.relationSemantics, requirement.relationSemantics) &&
      containsAll(profile.acceptedReferenceKinds, requirement.acceptedReferenceKinds) &&
      containsAll(profile.producedReferenceKinds, requirement.producedReferenceKinds) &&
      spatialMatch &&
      profile.timeSemantics === requirement.timeSemantics &&
      profile.resultNature === requirement.resultNature;
  if (!semanticMatch) {
    return {
      rejection: {
        reason: "SEMANTIC_MISMATCH",
        details: {
          operationKey: key,
          expected: {
            domain: requirement.domain,
            relationSemantics: requirement.relationSemantics,
            acceptedReferenceKinds: requirement.acceptedReferenceKinds,
            producedReferenceKinds: requirement.producedReferenceKinds,
            spatialSemantics: options.verifier ? "EXACT" : requirement.spatialSemantics,
            timeSemantics: requirement.timeSemantics,
            resultNature: options.verifier ? undefined : requirement.resultNature
          },
          actual: {
            domain: profile.domain,
            relationSemantics: profile.relationSemantics,
            acceptedReferenceKinds: profile.acceptedReferenceKinds,
            producedReferenceKinds: profile.producedReferenceKinds,
            spatialSemantics: profile.spatialSemantics,
            timeSemantics: profile.timeSemantics,
            resultNature: profile.resultNature
          }
        }
      }
    };
  }
  if (
    (options.verifier
      ? descriptor.ports.inputs.length === 0 || descriptor.ports.outputs.length === 0
      : !portsMatch(descriptor.ports.inputs, requirement.inputPorts) ||
        !portsMatch(descriptor.ports.outputs, requirement.outputPorts))
  ) {
    return {
      rejection: {
        reason: "PORT_MISMATCH",
        details: { operationKey: key, inputPorts: requirement.inputPorts, outputPorts: requirement.outputPorts }
      }
    };
  }

  const maturity = descriptor.maturity;
  const status = availability.availability;
  if ((maturity !== "STABLE" && maturity !== "PREVIEW") || (status !== "AVAILABLE" && status !== "DEGRADED")) {
    throw new Error("MATCHER_POLICY_NARROWING_DRIFT");
  }
  const matched: MatchedCapability = {
    descriptor,
    lock,
    semanticProfile: profile,
    availability,
    binding: {
      requirementId: requirement.requirementId,
      operationId: descriptor.operationId,
      operationVersion: descriptor.operationVersion,
      inputSchemaHash: descriptor.inputSchemaHash,
      outputSchemaHash: descriptor.outputSchemaHash,
      semanticProfileHash: lock.semanticProfileHash,
      maturity,
      availability: status,
      snapshotSupport: lock.snapshotSupport!,
      requiredPermissions: [...(lock.requiredPermissions ?? [])].sort(),
      matchEvidence: {
        operationKey: key,
        domain: profile.domain,
        relationSemantics: [...profile.relationSemantics].sort(),
        acceptedReferenceKinds: [...profile.acceptedReferenceKinds].sort(),
        producedReferenceKinds: [...profile.producedReferenceKinds].sort(),
        spatialSemantics: profile.spatialSemantics,
        timeSemantics: profile.timeSemantics,
        resultNature: profile.resultNature,
        schemasLocked: true,
        portsLocked: true,
        snapshotMode: requirement.snapshotMode,
        availabilityObservedAt: availability.checkedAt
      },
      selectionPolicy: "UNRESOLVED"
    }
  };
  return { matched, candidateForExactVerification };
}

function selectCandidate(
  requirement: SemanticCapabilityRequirement,
  candidates: MatchedCapability[]
): { selected?: MatchedCapability; policy?: string; gap?: CapabilityGap } {
  if (candidates.length === 1) {
    return { selected: candidates[0]!, policy: "UNIQUE_SEMANTIC_MATCH" };
  }
  const byKey = new Map(candidates.map((candidate) => [operationKey(candidate.descriptor), candidate]));
  for (const key of requirement.selectionPriority ?? []) {
    const selected = byKey.get(key);
    if (selected) return { selected, policy: `FROZEN_PRIORITY:${key}` };
  }
  return {
    gap: capabilityGap(requirement, "AMBIGUOUS_MATCH", {
      operationKeys: [...byKey.keys()].sort(),
      frozenPriorityPresent: (requirement.selectionPriority?.length ?? 0) > 0
    })
  };
}

function rejectionGap(
  requirement: SemanticCapabilityRequirement,
  rejections: Array<{ reason: CapabilityGapReason; details: Record<string, unknown> }>
): CapabilityGap {
  const priority: CapabilityGapReason[] = [
    "MATURITY_NOT_ALLOWED",
    "OPERATION_UNAVAILABLE",
    "OPERATION_DEGRADED",
    "AVAILABILITY_STALE",
    "SNAPSHOT_UNSUPPORTED",
    "SCHEMA_MISMATCH",
    "PORT_MISMATCH",
    "SEMANTIC_MISMATCH",
    "NOT_REGISTERED"
  ];
  const selected = priority
    .map((reason) => rejections.find((rejection) => rejection.reason === reason))
    .find((rejection) => rejection !== undefined) ?? {
      reason: "NOT_REGISTERED" as const,
      details: {}
    };
  return capabilityGap(requirement, selected.reason, {
    ...selected.details,
    substituted: false,
    evaluated: rejections.map((rejection) => ({ reason: rejection.reason, ...rejection.details }))
  });
}

export class CapabilityMatcher {
  match(input: CapabilityMatchInput): CapabilityMatchResult {
    const allowed = input.requirement.allowedOperationKeys === undefined
      ? undefined
      : new Set(input.requirement.allowedOperationKeys);
    const locks = input.operationLocks
      .filter((lock) => allowed === undefined || allowed.has(operationKey(lock)))
      .sort((left, right) => operationKey(left).localeCompare(operationKey(right)));
    if (locks.length === 0) {
      return {
        status: "CAPABILITY_GAP",
        gap: capabilityGap(input.requirement, "NOT_REGISTERED", {
          allowedOperationKeys: [...(input.requirement.allowedOperationKeys ?? [])],
          substituted: false
        })
      };
    }

    const evaluated = locks.map((lock) => evaluateCandidate(input, lock, input.requirement));
    const candidates = evaluated.flatMap((entry) => entry.matched === undefined ? [] : [entry.matched]);
    if (candidates.length === 0) {
      return {
        status: "CAPABILITY_GAP",
        gap: rejectionGap(
          input.requirement,
          evaluated.flatMap((entry) => entry.rejection === undefined ? [] : [entry.rejection])
        )
      };
    }
    const selection = selectCandidate(input.requirement, candidates);
    if (!selection.selected || !selection.policy) {
      return { status: "CAPABILITY_GAP", gap: selection.gap! };
    }
    selection.selected.binding.selectionPolicy = selection.policy;

    const selectedEvaluation = evaluated.find((entry) => entry.matched === selection.selected);
    if (selectedEvaluation?.candidateForExactVerification !== true) {
      return { status: "MATCHED", primary: selection.selected };
    }
    const verifierRef = selection.selected.semanticProfile.exactVerification;
    if (!verifierRef) {
      return {
        status: "CAPABILITY_GAP",
        gap: capabilityGap(input.requirement, "EXACT_VERIFIER_REQUIRED", {
          operationKey: operationKey(selection.selected.descriptor)
        })
      };
    }
    const verifierKey = operationKey(verifierRef);
    const verifierLock = input.operationLocks.find((lock) => operationKey(lock) === verifierKey);
    if (!verifierLock) {
      return {
        status: "CAPABILITY_GAP",
        gap: capabilityGap(input.requirement, "EXACT_VERIFIER_UNAVAILABLE", {
          verifierOperationKey: verifierKey,
          reason: "NOT_LOCKED"
        })
      };
    }
    const verifier = evaluateCandidate(input, verifierLock, input.requirement, { verifier: true });
    if (!verifier.matched) {
      return {
        status: "CAPABILITY_GAP",
        gap: capabilityGap(input.requirement, "EXACT_VERIFIER_UNAVAILABLE", {
          verifierOperationKey: verifierKey,
          rejection: verifier.rejection
        })
      };
    }
    verifier.matched.binding.selectionPolicy = `EXACT_VERIFIER:${verifierKey}`;
    return {
      status: "MATCHED",
      primary: selection.selected,
      exactVerification: verifier.matched
    };
  }
}

export function availabilityFor(
  operationId: string,
  operationVersion: string,
  status: OperationAvailability["availability"],
  observedAt: string
): OperationAvailability {
  return {
    operationId,
    operationVersion,
    maturity: "STABLE",
    availability: status,
    reasonCodes: [],
    checkedAt: observedAt,
    validUntil: new Date(Date.parse(observedAt) + 60_000).toISOString(),
    contractCatalogRevision: "sha256:test",
    bindingRevision: "sha256:test"
  };
}
