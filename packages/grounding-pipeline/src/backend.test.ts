import { describe, expect, it, vi } from "vitest";

import {
  ProductionBackendError,
  ProductionGroundingBackend,
  type DurableGroundingSubmission,
  type DurableSubmissionOutcome,
  type ProductionGroundingIdentity,
  type ProductionGroundingStore
} from "./backend.js";
import { utf8Sha256 } from "./canonical.js";

const identity: ProductionGroundingIdentity = {
  servicePrincipalId: "sacs-service",
  actorId: "operator-1",
  dataScopes: ["region-a"],
  datasetScopes: ["vehicles"],
  permissions: ["grounding.read"],
  authorizationContextHash: `sha256:${"a".repeat(64)}`
};

const admissionSnapshot = {
  immutableLocks: { snapshotHash: `sha256:${"e".repeat(64)}` },
  gowmContractCatalogRevision: `sha256:${"1".repeat(64)}`,
  gowmSemanticCatalogHash: `sha256:${"2".repeat(64)}`,
  gowmConsumerPackageIntegrity: `sha512-${Buffer.alloc(64, 3).toString("base64")}`,
  gowmOperationLockHash: `sha256:${"4".repeat(64)}`
};

function request(text = "查询2号车"): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    requestId: "request-1",
    operation: "EXECUTE_WORLD_QUERY",
    source: {
      messageId: "message-1",
      originalText: text,
      originalTextSha256: utf8Sha256(text),
      locale: "zh-CN"
    },
    executionPolicy: { readOnly: true, deadlineMs: 5_000, maxResultBytes: 1_048_576 }
  };
}

class MemoryBackendStore implements ProductionGroundingStore {
  readonly submissions: DurableGroundingSubmission[] = [];
  outcome: DurableSubmissionOutcome = {
    kind: "CREATED",
    groundingId: "grounding-original",
    jobId: "job-original",
    job: { status: "ACCEPTED" }
  };
  waitValue = { kind: "RESULT" as const, value: { status: "COMPLETED" } };

  async submit(submission: DurableGroundingSubmission): Promise<DurableSubmissionOutcome> {
    this.submissions.push(submission);
    return this.outcome;
  }

  async waitForTerminal(): Promise<typeof this.waitValue> {
    return this.waitValue;
  }

  async get(): Promise<unknown> {
    return { status: "RUNNING" };
  }

  async cancel(): Promise<{ jobId: string; value: unknown }> {
    return { jobId: "job-original", value: { status: "CANCELLED" } };
  }
}

function backend(store = new MemoryBackendStore()) {
  const seal = vi.fn(async (_plaintext: Uint8Array) => new Uint8Array([7, 8, 9]));
  const notify = vi.fn();
  let id = 0;
  return {
    store,
    seal,
    notify,
    value: new ProductionGroundingBackend({
      store,
      sealer: { seal },
      readiness: async () => ({ ready: true, reasons: [] }),
      capabilities: async () => ({ service: "wsgs", executable: true }),
      captureAdmissionSnapshot: async () => admissionSnapshot,
      cancellationNotifier: { notify },
      now: () => Date.parse("2026-08-27T00:00:00Z"),
      newId: () => String(++id).padStart(8, "0")
    })
  };
}

describe("ProductionGroundingBackend", () => {
  it("durably submits ciphertext and returns a queued job for async requests", async () => {
    const fixture = backend();
    const result = await fixture.value.create(identity, "idem-1", request(), true);
    expect(result).toEqual({ kind: "JOB", value: { status: "ACCEPTED" } });
    expect(fixture.store.submissions).toHaveLength(1);
    expect(fixture.store.submissions[0]).toMatchObject({
      operation: "EXECUTE_WORLD_QUERY",
      idempotencyKey: "idem-1",
      sourceTextSha256: utf8Sha256("查询2号车"),
      maxResultBytes: 1_048_576,
      identity: { actorId: "operator-1", dataScope: "region-a" }
    });
    expect(fixture.store.submissions[0]?.sealedRequest).toEqual(new Uint8Array([7, 8, 9]));
    expect(JSON.stringify(fixture.store.submissions[0]?.requestMetadata)).not.toContain("查询2号车");
  });

  it("waits for the durable terminal presentation for synchronous requests", async () => {
    const fixture = backend();
    await expect(fixture.value.create(identity, "idem-sync", request(), false)).resolves.toEqual({
      kind: "RESULT",
      value: { status: "COMPLETED" }
    });
  });

  it("replays the exact stored result instead of enqueuing model or GOWM work", async () => {
    const store = new MemoryBackendStore();
    const exact = { status: "COMPLETED", resultHash: `sha256:${"b".repeat(64)}` };
    store.outcome = { kind: "REPLAY_RESULT", groundingId: "grounding-existing", result: exact };
    const fixture = backend(store);
    await expect(fixture.value.create(identity, "idem-replay", request(), true)).resolves.toEqual({
      kind: "RESULT",
      value: exact
    });
  });

  it("rejects source drift before durable submission", async () => {
    const fixture = backend();
    const drift = request();
    (drift["source"] as Record<string, unknown>)["originalTextSha256"] = `sha256:${"0".repeat(64)}`;
    await expect(fixture.value.create(identity, "idem-drift", drift, true)).rejects.toMatchObject({
      code: "SOURCE_HASH_MISMATCH"
    });
    expect(fixture.store.submissions).toHaveLength(0);
  });

  it("requires an explicit authorized scope when identity has multiple scopes", async () => {
    const fixture = backend();
    const multiple = { ...identity, dataScopes: ["region-a", "region-b"] };
    await expect(fixture.value.create(multiple, "idem-scope", request(), true)).rejects.toMatchObject({
      code: "DATA_SCOPE_SELECTION_REQUIRED"
    });
    const expanded = new ProductionGroundingBackend({
      store: fixture.store,
      sealer: { seal: fixture.seal },
      readiness: async () => ({ ready: true, reasons: [] }),
      capabilities: async () => ({}),
      captureAdmissionSnapshot: async () => admissionSnapshot,
      selectDataScope: () => "region-c"
    });
    await expect(expanded.create(multiple, "idem-expand", request(), true)).rejects.toBeInstanceOf(ProductionBackendError);
  });

  it("propagates scoped cancellation to the live worker notifier", async () => {
    const fixture = backend();
    await expect(fixture.value.cancel(identity, "grounding-original")).resolves.toEqual({ status: "CANCELLED" });
    expect(fixture.notify).toHaveBeenCalledWith("job-original");
  });

  it("fails closed before durable submission when required production capabilities are not ready", async () => {
    const fixture = backend();
    const unavailable = new ProductionGroundingBackend({
      store: fixture.store,
      sealer: { seal: fixture.seal },
      readiness: async () => ({ ready: false, reasons: ["MODEL_HEALTH_NOT_READY"] }),
      capabilities: async () => ({}),
      captureAdmissionSnapshot: async () => admissionSnapshot
    });
    await expect(unavailable.create(identity, "idem-not-ready", request(), true)).rejects.toMatchObject({
      code: "NOT_READY"
    });
    expect(fixture.store.submissions).toHaveLength(0);
  });
});
