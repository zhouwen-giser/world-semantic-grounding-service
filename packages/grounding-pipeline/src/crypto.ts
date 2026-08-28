import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { canonicalBytes } from "./canonical.js";
import type { RequestSealer } from "./backend.js";
import type { PipelineCheckpoint } from "./types.js";

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class PayloadCipherError extends Error {
  readonly code = "PAYLOAD_CIPHER_ERROR";
}

export interface RequestOpenContext {
  groundingId: string;
  requestId: string;
}

export interface CheckpointCipherContext {
  jobId: string;
  runFingerprint: string;
}

function associatedData(purpose: "REQUEST" | "CHECKPOINT", context: unknown): Uint8Array {
  return canonicalBytes({ schemaVersion: "1.0", purpose, context });
}

export class Aes256GcmPayloadCodec implements RequestSealer {
  readonly #key: Buffer;

  constructor(key: Uint8Array) {
    if (key.byteLength !== 32) throw new PayloadCipherError("AES-256-GCM key must be exactly 32 bytes");
    this.#key = Buffer.from(key);
  }

  static fromBase64(value: string): Aes256GcmPayloadCodec {
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new PayloadCipherError("Encryption key is not valid base64");
    const key = Buffer.from(value, "base64");
    if (key.byteLength !== 32) throw new PayloadCipherError("Base64 encryption key must decode to exactly 32 bytes");
    return new Aes256GcmPayloadCodec(key);
  }

  async seal(plaintext: Uint8Array, context: RequestOpenContext): Promise<Uint8Array> {
    return this.#encrypt(plaintext, associatedData("REQUEST", context));
  }

  async openRequest(ciphertext: Uint8Array, context: RequestOpenContext): Promise<Uint8Array> {
    return this.#decrypt(ciphertext, associatedData("REQUEST", context));
  }

  async sealCheckpoint(checkpoint: PipelineCheckpoint): Promise<Uint8Array> {
    return this.#encrypt(
      canonicalBytes(checkpoint.state),
      associatedData("CHECKPOINT", { jobId: checkpoint.jobId, runFingerprint: checkpoint.runFingerprint })
    );
  }

  async openCheckpoint(ciphertext: Uint8Array, context: CheckpointCipherContext): Promise<Uint8Array> {
    return this.#decrypt(ciphertext, associatedData("CHECKPOINT", context));
  }

  #encrypt(plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return new Uint8Array(Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, tag, encrypted]));
  }

  #decrypt(ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
    if (ciphertext.byteLength < 1 + IV_BYTES + TAG_BYTES || ciphertext[0] !== FORMAT_VERSION) {
      throw new PayloadCipherError("Ciphertext envelope is invalid");
    }
    try {
      const bytes = Buffer.from(ciphertext);
      const iv = bytes.subarray(1, 1 + IV_BYTES);
      const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const encrypted = bytes.subarray(1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]));
    } catch (error) {
      throw new PayloadCipherError(`Ciphertext authentication failed: ${error instanceof Error ? error.name : "UNKNOWN"}`);
    }
  }
}
