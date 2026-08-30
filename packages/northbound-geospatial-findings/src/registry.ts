import {
  defaultSacsGeospatialSchemaRegistry,
  type SACSGeospatialTypedGap10
} from "@wsgs/contracts";

import { canonicalJson, canonicalSha256, compareCodePoints, deterministicId } from "./canonical.js";
import { decodeStandardFinding, decoderGapsForFinding } from "./decoders.js";
import type {
  DecoderCoverageCandidate,
  DecoderCoverageRow,
  DecoderCoverageSummary,
  DecoderMatch,
  DecoderPriority,
  DecoderSelection,
  FindingDecodeBatchResult,
  FindingDecodeResult,
  FindingDecoderInput,
  FindingDecoderPattern,
  FindingDecoderRegistration,
  Sha256Digest,
  StandardDecoderSchemaBinding
} from "./types.js";
import {
  FindingDecoderError,
  digest,
  text,
  validateDecoderInput
} from "./validation.js";

const priorityRank: Readonly<Record<DecoderPriority, number>> = {
  EXACT_OPERATION_SCHEMA: 3,
  SEMANTIC_PROFILE: 2,
  GENERIC_PATTERN: 1
};

function matchSpecificity(match: DecoderMatch): number {
  return Object.values(match).filter((value) => value !== undefined).length;
}

function matches(match: DecoderMatch, input: FindingDecoderInput): boolean {
  const output = input.envelope.output;
  if (output === undefined
    || output.schemaUri !== match.payloadSchemaUri
    || output.schemaHash !== match.payloadSchemaHash) return false;
  return (match.operationId === undefined || match.operationId === input.envelope.operation.operationId)
    && (match.operationVersion === undefined
      || match.operationVersion === input.envelope.operation.operationVersion)
    && (match.semanticProfileHash === undefined
      || match.semanticProfileHash === input.descriptor.semanticProfileHash)
    && (match.productType === undefined || match.productType === input.descriptor.productType)
    && (match.productProfile === undefined || match.productProfile === input.descriptor.productProfile)
    && (match.querySemantics === undefined || match.querySemantics === input.descriptor.querySemantics)
    && (match.queryProfile === undefined || match.queryProfile === input.descriptor.queryProfile);
}

function candidateMatches(
  match: DecoderMatch,
  candidate: DecoderCoverageCandidate,
  queryProfile: FindingDecoderPattern
): boolean {
  return match.payloadSchemaUri === candidate.payloadSchemaUri
    && match.payloadSchemaHash === candidate.payloadSchemaHash
    && (match.operationId === undefined || match.operationId === candidate.operationId)
    && (match.operationVersion === undefined || match.operationVersion === candidate.operationVersion)
    && (match.semanticProfileHash === undefined
      || match.semanticProfileHash === candidate.semanticProfileHash)
    && (match.productType === undefined || match.productType === candidate.productType)
    && (match.productProfile === undefined || match.productProfile === candidate.productProfile)
    && (match.querySemantics === undefined || match.querySemantics === candidate.querySemantics)
    && (match.queryProfile === undefined || match.queryProfile === queryProfile);
}

function validateRegistration(registration: FindingDecoderRegistration): void {
  text(registration.decoderId, "INVALID_DECODER_ID", 256);
  text(registration.match.payloadSchemaUri, "INVALID_DECODER_SCHEMA_URI", 2048);
  digest(registration.match.payloadSchemaHash, "INVALID_DECODER_SCHEMA_HASH");
  if (registration.priority === "EXACT_OPERATION_SCHEMA") {
    if (registration.match.operationId === undefined || registration.match.operationVersion === undefined) {
      throw new FindingDecoderError("EXACT_DECODER_OPERATION_REQUIRED");
    }
  } else if (registration.match.operationId !== undefined || registration.match.operationVersion !== undefined) {
    throw new FindingDecoderError("LOWER_PRIORITY_DECODER_OPERATION_FORBIDDEN");
  }
  if (registration.priority === "SEMANTIC_PROFILE"
    && registration.match.semanticProfileHash === undefined) {
    throw new FindingDecoderError("SEMANTIC_DECODER_PROFILE_HASH_REQUIRED");
  }
  if (registration.priority === "GENERIC_PATTERN"
    && registration.match.queryProfile !== registration.pattern) {
    throw new FindingDecoderError("GENERIC_DECODER_PATTERN_LOCK_REQUIRED");
  }
}

function selection(registration: FindingDecoderRegistration): DecoderSelection {
  return {
    decoderId: registration.decoderId,
    priority: registration.priority,
    pattern: registration.pattern
  };
}

function sortRegistrations(
  registrations: readonly FindingDecoderRegistration[]
): FindingDecoderRegistration[] {
  return [...registrations].sort((left, right) =>
    priorityRank[right.priority] - priorityRank[left.priority]
    || matchSpecificity(right.match) - matchSpecificity(left.match)
    || compareCodePoints(left.decoderId, right.decoderId));
}

function selectUnique(matchesValue: readonly FindingDecoderRegistration[]): FindingDecoderRegistration | undefined {
  const ordered = sortRegistrations(matchesValue);
  const first = ordered[0];
  if (first === undefined) return undefined;
  const second = ordered[1];
  if (second !== undefined
    && priorityRank[second.priority] === priorityRank[first.priority]
    && matchSpecificity(second.match) === matchSpecificity(first.match)) {
    throw new FindingDecoderError("AMBIGUOUS_DECODER_MATCH");
  }
  return first;
}

function typedGap(
  input: FindingDecoderInput,
  gapKind: SACSGeospatialTypedGap10["gapKind"],
  severity: SACSGeospatialTypedGap10["severity"],
  messageCode: string
): SACSGeospatialTypedGap10 {
  return {
    gapId: deterministicId("gap", {
      operation: input.envelope.operation,
      schema: input.envelope.output === undefined
        ? undefined
        : {
            uri: input.envelope.output.schemaUri,
            hash: input.envelope.output.schemaHash
          },
      semanticProfileHash: input.descriptor.semanticProfileHash,
      descriptorId: input.descriptor.descriptorId,
      descriptorHash: input.descriptor.descriptorHash,
      productType: input.descriptor.productType,
      productProfile: input.descriptor.productProfile,
      querySemantics: input.descriptor.querySemantics,
      queryProfile: input.descriptor.queryProfile,
      evidenceItemIds: [...input.trustedProvenance.evidenceItemIds].sort(compareCodePoints),
      sourceProductIds: [...input.trustedProvenance.sourceProductIds].sort(compareCodePoints),
      subjectReferenceProductIds: [
        ...(input.trustedProvenance.subjectReferenceProductIds ?? [])
      ].sort(compareCodePoints),
      gapKind,
      messageCode
    }),
    gapKind,
    severity,
    messageCode,
    semanticConcept: input.descriptor.semanticConcept,
    evidenceItemIds: [...input.trustedProvenance.evidenceItemIds].sort(compareCodePoints)
  };
}

function findingIdFor(
  input: FindingDecoderInput,
  selected: FindingDecoderRegistration
): string {
  const output = input.envelope.output;
  return deterministicId("finding", {
    operation: input.envelope.operation,
    outputSchema: output === undefined
      ? undefined
      : { schemaUri: output.schemaUri, schemaHash: output.schemaHash },
    semanticProfileHash: input.descriptor.semanticProfileHash,
    descriptorId: input.descriptor.descriptorId,
    descriptorHash: input.descriptor.descriptorHash,
    productType: input.descriptor.productType,
    productProfile: input.descriptor.productProfile,
    querySemantics: input.descriptor.querySemantics,
    queryProfile: input.descriptor.queryProfile,
    status: input.envelope.status,
    decoder: selection(selected),
    payload: stablePayloadForId(output?.value),
    evidenceItemIds: [...input.trustedProvenance.evidenceItemIds].sort(compareCodePoints),
    sourceProductIds: [...input.trustedProvenance.sourceProductIds].sort(compareCodePoints),
    subjectReferenceProductIds: [
      ...(input.trustedProvenance.subjectReferenceProductIds ?? [])
    ].sort(compareCodePoints)
  });
}

function stablePayloadForId(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => stablePayloadForId(item));
    return parentKey === "features" || parentKey === "products"
      ? normalized.sort((left, right) => compareCodePoints(canonicalJson(left), canonicalJson(right)))
      : normalized;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, item]) => [key, stablePayloadForId(item, key)]));
}

function emptyResult(
  input: FindingDecoderInput,
  status: FindingDecodeResult["status"],
  gap: SACSGeospatialTypedGap10,
  selected?: FindingDecoderRegistration
): FindingDecodeResult {
  const schemaRegistry = defaultSacsGeospatialSchemaRegistry();
  schemaRegistry.validate("typed-gap.schema.json", gap);
  return {
    status,
    ...(selected === undefined ? {} : { selection: selection(selected) }),
    findings: [],
    gaps: [gap],
    findingSetHash: canonicalSha256([])
  };
}

export class FindingDecoderRegistry {
  readonly #registrations: readonly FindingDecoderRegistration[];

  constructor(registrations: readonly FindingDecoderRegistration[]) {
    const ids = new Set<string>();
    for (const registration of registrations) {
      validateRegistration(registration);
      if (ids.has(registration.decoderId)) throw new FindingDecoderError("DUPLICATE_DECODER_ID");
      ids.add(registration.decoderId);
    }
    this.#registrations = sortRegistrations(registrations);
  }

  select(input: FindingDecoderInput): FindingDecoderRegistration | undefined {
    return selectUnique(this.#registrations.filter((registration) => matches(registration.match, input)));
  }

  decode(input: FindingDecoderInput): FindingDecodeResult {
    validateDecoderInput(input);
    if (input.envelope.status === "NO_DATA") {
      return emptyResult(
        input,
        "NO_DATA",
        typedGap(input, "DATA_GAP", "INFO", "WSGS_UPSTREAM_NO_DATA")
      );
    }
    if (input.envelope.status === "INDETERMINATE") {
      return emptyResult(
        input,
        "INDETERMINATE",
        typedGap(input, "DATA_GAP", "WARNING", "WSGS_UPSTREAM_INDETERMINATE")
      );
    }
    if (input.envelope.status === "FAILED") {
      return emptyResult(
        input,
        "INDETERMINATE",
        typedGap(input, "UPSTREAM_FAILURE", "BLOCKING", "WSGS_UPSTREAM_FAILURE")
      );
    }
    const selected = this.select(input);
    if (selected === undefined) {
      return emptyResult(
        input,
        input.envelope.status,
        typedGap(input, "UNSUPPORTED_FINDING_SCHEMA", "BLOCKING", "UNSUPPORTED_FINDING_SCHEMA")
      );
    }
    const output = input.envelope.output;
    if (output === undefined) throw new FindingDecoderError("RESULT_OUTPUT_REQUIRED");
    const context = {
      input,
      payload: output.value,
      findingId: findingIdFor(input, selected)
    };
    const finding = selected.decode === undefined
      ? decodeStandardFinding(selected.pattern, context)
      : selected.decode(context);
    if (finding === undefined) {
      const partial = input.envelope.status === "PARTIAL";
      return emptyResult(
        input,
        partial ? "PARTIAL" : "NO_DATA",
        typedGap(
          input,
          "DATA_GAP",
          partial ? "WARNING" : "INFO",
          partial ? "WSGS_UPSTREAM_PARTIAL_RESULT" : "WSGS_DECODER_NO_DATA"
        ),
        selected
      );
    }
    const schemaRegistry = defaultSacsGeospatialSchemaRegistry();
    schemaRegistry.validate("world-finding.schema.json", finding);
    const gaps = decoderGapsForFinding(finding);
    for (const gap of gaps) schemaRegistry.validate("typed-gap.schema.json", gap);
    const findings = [finding];
    return {
      status: finding.status,
      selection: selection(selected),
      findings,
      gaps,
      findingSetHash: canonicalSha256(findings)
    };
  }

  decodeAll(inputs: readonly FindingDecoderInput[]): FindingDecodeBatchResult {
    const results = inputs.map((input) => this.decode(input));
    const findings = results.flatMap((result) => [...result.findings])
      .sort((left, right) => compareCodePoints(left.findingId, right.findingId));
    const findingIds = new Set(findings.map(({ findingId }) => findingId));
    if (findingIds.size !== findings.length) throw new FindingDecoderError("DUPLICATE_FINDING_ID");
    const gaps = results.flatMap((result) => [...result.gaps])
      .sort((left, right) => compareCodePoints(left.gapId, right.gapId));
    const gapIds = new Set(gaps.map(({ gapId }) => gapId));
    if (gapIds.size !== gaps.length) throw new FindingDecoderError("DUPLICATE_GAP_ID");
    return {
      findings,
      gaps,
      findingSetHash: canonicalSha256(findings)
    };
  }

  coverage(candidates: readonly DecoderCoverageCandidate[]): DecoderCoverageSummary {
    const capabilityIds = new Set<string>();
    const rows = candidates.map((candidate): DecoderCoverageRow => {
      if (capabilityIds.has(candidate.capabilityId)) {
        throw new FindingDecoderError("DUPLICATE_COVERAGE_CAPABILITY");
      }
      capabilityIds.add(candidate.capabilityId);
      if (candidate.applicability === "NOT_APPLICABLE") {
        return {
          capabilityId: candidate.capabilityId,
          operationId: candidate.operationId,
          operationVersion: candidate.operationVersion,
          classification: "NOT_APPLICABLE",
          reason: "NON_FINDING_CAPABILITY"
        };
      }
      if (candidate.intentionalGapReason !== undefined) {
        return {
          capabilityId: candidate.capabilityId,
          operationId: candidate.operationId,
          operationVersion: candidate.operationVersion,
          classification: "INTENTIONALLY_GAP",
          reason: candidate.intentionalGapReason
        };
      }
      if (candidate.queryProfile === undefined && candidate.valueSemanticsKind === undefined
        && candidate.operationId === "geo-raster.sample") {
        const valueDecoder = selectUnique(this.#registrations.filter((registration) =>
          candidateMatches(registration.match, candidate, "SAMPLE_VALUE")));
        const classDecoder = selectUnique(this.#registrations.filter((registration) =>
          candidateMatches(registration.match, candidate, "SAMPLE_CLASS")));
        if (valueDecoder !== undefined && classDecoder !== undefined) {
          return {
            capabilityId: candidate.capabilityId,
            operationId: candidate.operationId,
            operationVersion: candidate.operationVersion,
            classification: "SUPPORTED",
            findingKindOptions: ["POINT_CLASSIFICATION", "POINT_MEASUREMENT"],
            reason: "LOCKED_DESCRIPTOR_VALUE_SEMANTICS_RESOLVES_PATTERN"
          };
        }
      }
      const resolvedQueryProfile = candidate.queryProfile
        ?? (candidate.valueSemanticsKind === "NUMBER"
          ? "SAMPLE_VALUE"
          : candidate.valueSemanticsKind === "CLASS_CODE"
            ? "SAMPLE_CLASS"
            : undefined);
      if (resolvedQueryProfile === undefined) {
        return {
          capabilityId: candidate.capabilityId,
          operationId: candidate.operationId,
          operationVersion: candidate.operationVersion,
          classification: "UNSUPPORTED_SCHEMA",
          reason: "QUERY_PROFILE_NOT_LOCKED"
        };
      }
      const selected = selectUnique(this.#registrations.filter((registration) =>
        candidateMatches(registration.match, candidate, resolvedQueryProfile)));
      if (selected === undefined) {
        return {
          capabilityId: candidate.capabilityId,
          operationId: candidate.operationId,
          operationVersion: candidate.operationVersion,
          classification: "UNSUPPORTED_SCHEMA",
          resolvedQueryProfile,
          reason: "NO_SCHEMA_BOUND_DECODER"
        };
      }
      return {
        capabilityId: candidate.capabilityId,
        operationId: candidate.operationId,
        operationVersion: candidate.operationVersion,
        classification: "SUPPORTED",
        decoderId: selected.decoderId,
        priority: selected.priority,
        resolvedQueryProfile
      };
    }).sort((left, right) => compareCodePoints(left.capabilityId, right.capabilityId));
    return {
      rows,
      counts: {
        total: rows.length,
        supported: rows.filter(({ classification }) => classification === "SUPPORTED").length,
        intentionallyGap: rows.filter(({ classification }) => classification === "INTENTIONALLY_GAP").length,
        unsupportedSchema: rows.filter(({ classification }) => classification === "UNSUPPORTED_SCHEMA").length,
        notApplicable: rows.filter(({ classification }) => classification === "NOT_APPLICABLE").length
      }
    };
  }
}

export function standardDecoderRegistrations(
  bindings: readonly StandardDecoderSchemaBinding[]
): FindingDecoderRegistration[] {
  return bindings.map((binding, index) => {
    const priority = binding.priority ?? "GENERIC_PATTERN";
    return {
      decoderId: binding.decoderId ?? `standard.${binding.pattern.toLowerCase()}.${index}`,
      priority,
      pattern: binding.pattern,
      match: {
        payloadSchemaUri: binding.payloadSchemaUri,
        payloadSchemaHash: binding.payloadSchemaHash,
        ...(binding.operationId === undefined ? {} : { operationId: binding.operationId }),
        ...(binding.operationVersion === undefined ? {} : { operationVersion: binding.operationVersion }),
        ...(binding.semanticProfileHash === undefined
          ? {}
          : { semanticProfileHash: binding.semanticProfileHash }),
        ...(binding.productType === undefined ? {} : { productType: binding.productType }),
        ...(binding.productProfile === undefined ? {} : { productProfile: binding.productProfile }),
        ...(binding.querySemantics === undefined ? {} : { querySemantics: binding.querySemantics }),
        queryProfile: binding.matchQueryProfile ?? binding.pattern
      }
    };
  });
}

export function canonicalDecoderCoverage(summary: DecoderCoverageSummary): string {
  return canonicalJson(summary);
}

export function decoderCoverageHash(summary: DecoderCoverageSummary): Sha256Digest {
  return canonicalSha256(summary);
}
