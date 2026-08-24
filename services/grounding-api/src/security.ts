import type { GroundingIdentity } from "./types.js";

export class ApiSecurityError extends Error {
  constructor(readonly code: string, readonly statusCode: number) {
    super(`API security policy rejected input: ${code}`);
  }
}

export interface RateBudgetConfig {
  requests: number;
  windowMs: number;
  maxTrackedKeys?: number;
  now?: () => number;
}

interface BudgetWindow {
  startedAt: number;
  used: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

export class ScopedRateBudget {
  readonly #windows = new Map<string, BudgetWindow>();
  readonly #requests: number;
  readonly #windowMs: number;
  readonly #maxTrackedKeys: number;
  readonly #now: () => number;

  constructor(config: RateBudgetConfig) {
    assertPositiveInteger(config.requests, "requests");
    assertPositiveInteger(config.windowMs, "windowMs");
    this.#requests = config.requests;
    this.#windowMs = config.windowMs;
    this.#maxTrackedKeys = config.maxTrackedKeys ?? 10_000;
    assertPositiveInteger(this.#maxTrackedKeys, "maxTrackedKeys");
    this.#now = config.now ?? Date.now;
  }

  consume(identity: GroundingIdentity): void {
    const now = this.#now();
    const key = `${identity.principalId}\u0000${identity.dataScope}`;
    let window = this.#windows.get(key);
    if (!window || now - window.startedAt >= this.#windowMs) {
      if (!window && this.#windows.size >= this.#maxTrackedKeys) this.#evictExpired(now);
      if (!window && this.#windows.size >= this.#maxTrackedKeys) throw new ApiSecurityError("RATE_BUDGET_CAPACITY", 429);
      window = { startedAt: now, used: 0 };
      this.#windows.set(key, window);
    }
    if (window.used >= this.#requests) throw new ApiSecurityError("RATE_BUDGET_EXCEEDED", 429);
    window.used += 1;
  }

  #evictExpired(now: number): void {
    for (const [key, window] of this.#windows) {
      if (now - window.startedAt >= this.#windowMs) this.#windows.delete(key);
    }
  }
}

const forbiddenControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const unpairedSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const excessiveCombiningMarks = /\p{M}{33,}/u;

export function assertSafeUnicodeText(value: string): void {
  if (forbiddenControl.test(value)) throw new ApiSecurityError("UNSAFE_CONTROL_CHARACTER", 400);
  if (unpairedSurrogate.test(value)) throw new ApiSecurityError("INVALID_UNICODE_SEQUENCE", 400);
  if (excessiveCombiningMarks.test(value.normalize("NFD"))) throw new ApiSecurityError("UNICODE_COMBINING_LIMIT", 400);
}
