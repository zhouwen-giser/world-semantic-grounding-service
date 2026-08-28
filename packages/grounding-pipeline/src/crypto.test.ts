import { describe, expect, it } from "vitest";

import { Aes256GcmPayloadCodec, PayloadCipherError } from "./crypto.js";
import type { PipelineCheckpoint } from "./types.js";

const codec = new Aes256GcmPayloadCodec(new Uint8Array(Array.from({ length: 32 }, (_value, index) => index)));

describe("Aes256GcmPayloadCodec", () => {
  it("round-trips request bytes only with the exact grounding/request associated data", async () => {
    const plaintext = new TextEncoder().encode('{"originalText":"sensitive"}');
    const ciphertext = await codec.seal(plaintext, { groundingId: "grounding-1", requestId: "request-1" });
    expect(ciphertext).not.toEqual(plaintext);
    expect(Buffer.from(ciphertext).includes(Buffer.from("sensitive"))).toBe(false);
    await expect(codec.openRequest(ciphertext, {
      groundingId: "grounding-1",
      requestId: "request-1"
    })).resolves.toEqual(plaintext);
    await expect(codec.openRequest(ciphertext, {
      groundingId: "grounding-other",
      requestId: "request-1"
    })).rejects.toBeInstanceOf(PayloadCipherError);
  });

  it("rejects authenticated ciphertext tampering", async () => {
    const ciphertext = await codec.seal(new Uint8Array([1, 2, 3]), {
      groundingId: "grounding-1",
      requestId: "request-1"
    });
    ciphertext[ciphertext.length - 1] = (ciphertext[ciphertext.length - 1] ?? 0) ^ 1;
    await expect(codec.openRequest(ciphertext, {
      groundingId: "grounding-1",
      requestId: "request-1"
    })).rejects.toBeInstanceOf(PayloadCipherError);
  });

  it("binds encrypted checkpoint state to its job and run fingerprint", async () => {
    const checkpoint: PipelineCheckpoint = {
      schemaVersion: "1.0",
      jobId: "job-1",
      operation: "EXECUTE_WORLD_QUERY",
      runFingerprint: `sha256:${"1".repeat(64)}`,
      nextStageIndex: 3,
      nextEventSequence: 6,
      state: { secretIntermediate: "not-plaintext" },
      previousRecordHash: `sha256:${"2".repeat(64)}`,
      lastCompletedStage: "SEMANTIC_MODEL_PARSE"
    };
    const ciphertext = await codec.sealCheckpoint(checkpoint);
    expect(Buffer.from(ciphertext).includes(Buffer.from("not-plaintext"))).toBe(false);
    const opened = await codec.openCheckpoint(ciphertext, {
      jobId: checkpoint.jobId,
      runFingerprint: checkpoint.runFingerprint
    });
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual(checkpoint.state);
    await expect(codec.openCheckpoint(ciphertext, {
      jobId: checkpoint.jobId,
      runFingerprint: `sha256:${"3".repeat(64)}`
    })).rejects.toBeInstanceOf(PayloadCipherError);
  });
});
