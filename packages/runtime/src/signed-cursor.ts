import { createHmac, timingSafeEqual } from "node:crypto";

export class InvalidCursorError extends Error {
  readonly code = "INVALID_CURSOR";

  constructor() {
    super("Cursor verification failed");
  }
}

interface CursorPayload {
  v: 1;
  scope: string;
  position: string;
  expiresAt: number;
}

export class SignedCursorCodec {
  readonly #key: Uint8Array;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(config: { key: Uint8Array; ttlMs: number; now?: () => number }) {
    if (config.key.byteLength < 32) throw new Error("cursor key must contain at least 32 bytes");
    if (!Number.isInteger(config.ttlMs) || config.ttlMs < 1) throw new Error("cursor ttlMs must be a positive integer");
    this.#key = config.key.slice();
    this.#ttlMs = config.ttlMs;
    this.#now = config.now ?? Date.now;
  }

  encode(dataScope: string, position: string): string {
    if (dataScope.length < 1 || dataScope.length > 256 || position.length < 1 || position.length > 512) {
      throw new InvalidCursorError();
    }
    const encoded = Buffer.from(JSON.stringify({
      v: 1,
      scope: dataScope,
      position,
      expiresAt: this.#now() + this.#ttlMs
    } satisfies CursorPayload)).toString("base64url");
    return `${encoded}.${this.#sign(encoded)}`;
  }

  decode(dataScope: string, cursor: string): string {
    if (cursor.length > 2048) throw new InvalidCursorError();
    const [encoded, signature, extra] = cursor.split(".");
    if (!encoded || !signature || extra !== undefined) throw new InvalidCursorError();
    const actual = Buffer.from(signature, "base64url");
    const expected = Buffer.from(this.#sign(encoded), "base64url");
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) throw new InvalidCursorError();
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new InvalidCursorError();
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new InvalidCursorError();
    const value = payload as Record<string, unknown>;
    if (value["v"] !== 1 || value["scope"] !== dataScope || typeof value["position"] !== "string"
      || value["position"].length < 1 || value["position"].length > 512
      || typeof value["expiresAt"] !== "number" || value["expiresAt"] < this.#now()) {
      throw new InvalidCursorError();
    }
    return value["position"];
  }

  #sign(encoded: string): string {
    return createHmac("sha256", this.#key).update(encoded).digest("base64url");
  }
}
