import { describe, expect, it } from "vitest";
import type { GroundingEvidenceItem } from "./types.js";
import { OperationalProductAssembler } from "./index.js";

function item(productKind: GroundingEvidenceItem["productKind"], safePayload: unknown): GroundingEvidenceItem {
  return {
    evidenceProductId: `evidence-${productKind.toLowerCase()}`,
    productKind,
    authority: "gowm",
    sourceOperation: "locked.operation",
    sourceProvider: "gowm.provider",
    upstreamStatus: "COMPLETED",
    payloadSchemaUri: "urn:test",
    payloadSchemaHash: `sha256:${"a".repeat(64)}`,
    safePayload,
    receiptIds: [],
    evidenceIds: ["evidence-source-1"],
    unknowns: [],
    warnings: []
  };
}

describe("OperationalProductAssembler", () => {
  it("preserves all four operational task dimensions without promoting completion to verification", () => {
    const task = item("OPERATIONAL_TASK", {
      controlState: "COMPLETED_REPORTED",
      activityState: "STOPPED_OBSERVED",
      outcomeVerification: "UNVERIFIED",
      observability: "OBSERVATION_GAP",
      externalAuthority: "opaque.external.system"
    });
    const result = new OperationalProductAssembler().assemble({ requestedProducts: ["OPERATIONAL_TASKS"], evidenceItems: [task] });
    expect(result.evidenceItems[0]?.safePayload).toEqual(task.safePayload);
    expect(result.evidenceItems[0]?.safePayload).toMatchObject({
      controlState: "COMPLETED_REPORTED",
      outcomeVerification: "UNVERIFIED"
    });
    expect(JSON.stringify(result)).not.toContain('"VERIFIED"');
  });

  it("preserves exact, conflicting, and no-match correlation semantics without inventing a task", () => {
    const exact = item("CORRELATION_FINDING", { relation: "REALIZES", externalAuthority: "opaque", operationalTaskReferenceKey: { id: "task-1" } });
    const conflict = { ...item("CORRELATION_FINDING", { relation: "CONFLICTING_MATCHES", externalAuthority: "opaque" }), evidenceProductId: "evidence-conflict" };
    const none = { ...item("CORRELATION_FINDING", { relation: "NO_MATCH_FOUND", externalAuthority: "opaque" }), evidenceProductId: "evidence-none" };
    const result = new OperationalProductAssembler().assemble({
      requestedProducts: ["CORRELATION_FINDINGS"], evidenceItems: [exact, conflict, none]
    });
    expect(result.evidenceItems.map((entry) => (entry.safePayload as Record<string, unknown>)["relation"]).sort()).toEqual([
      "CONFLICTING_MATCHES", "NO_MATCH_FOUND", "REALIZES"
    ]);
    expect((result.evidenceItems.find((entry) => entry.evidenceProductId === "evidence-none")?.safePayload as Record<string, unknown>))
      .not.toHaveProperty("operationalTaskReferenceKey");
  });

  it("preserves predicate status, positive/negative evidence, and observability assessment", () => {
    const predicate = item("PREDICATE_EVALUATION", {
      status: "NOT_SUPPORTED",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: ["world-evidence-negative"],
      observabilityAssessment: { status: "SUFFICIENT", sources: ["sensor"] }
    });
    const result = new OperationalProductAssembler().assemble({ requestedProducts: ["PREDICATE_EVALUATIONS"], evidenceItems: [predicate] });
    expect(result.evidenceItems[0]?.safePayload).toEqual(predicate.safePayload);
  });

  it("retains stable scoped timeline order and truncation state", () => {
    const timeline = item("EVENT_TIMELINE", {
      schemaVersion: "1.0",
      events: [{ eventId: "event-1" }, { eventId: "event-2" }],
      truncated: true,
      nextCursor: "opaque-cursor"
    });
    const result = new OperationalProductAssembler().assemble({ requestedProducts: ["EVENT_TIMELINES"], evidenceItems: [timeline] });
    expect((result.evidenceItems[0]?.safePayload as Record<string, unknown>)["events"]).toEqual([
      { eventId: "event-1" }, { eventId: "event-2" }
    ]);
  });

  it("returns explicit optional gaps and never substitutes another product", () => {
    const result = new OperationalProductAssembler().assemble({
      requestedProducts: ["OPERATIONAL_TASKS", "PREDICATE_EVALUATIONS"],
      evidenceItems: []
    });
    expect(result.status).toBe("PARTIAL");
    expect(result.capabilityGaps).toHaveLength(2);
    expect(result.capabilityGaps.every((gap) => gap.blocking === false && gap.details["substituted"] === false)).toBe(true);
    expect(result.evidenceItems).toEqual([]);
  });

  it("does no mutation and keeps external authority values opaque", () => {
    const source = item("CORRELATION_FINDING", {
      relation: "POSSIBLY_CORRESPONDS_TO",
      externalAuthority: "sdar-like-but-opaque",
      externalValue: "opaque:command:123"
    });
    const original = structuredClone(source);
    const result = new OperationalProductAssembler().assemble({ requestedProducts: ["CORRELATION_FINDINGS"], evidenceItems: [source] });
    expect(source).toEqual(original);
    expect(result.evidenceItems[0]?.safePayload).toEqual(original.safePayload);
  });
});
