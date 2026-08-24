export class CircuitOpenError extends Error {
  constructor(readonly retryAt: number) {
    super("GOWM Gateway circuit is open");
  }
}

export class CircuitBreaker {
  #failures = 0;
  #openedUntil = 0;
  #probeInFlight = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now
  ) {
    if (failureThreshold < 1 || cooldownMs < 1) throw new Error("Invalid circuit breaker policy");
  }

  beforeRequest(): void {
    const now = this.now();
    if (this.#openedUntil === 0) return;
    if (now < this.#openedUntil || this.#probeInFlight) throw new CircuitOpenError(this.#openedUntil);
    this.#probeInFlight = true;
  }

  success(): void {
    this.#failures = 0;
    this.#openedUntil = 0;
    this.#probeInFlight = false;
  }

  failure(): void {
    this.#probeInFlight = false;
    this.#failures += 1;
    if (this.#failures >= this.failureThreshold) this.#openedUntil = this.now() + this.cooldownMs;
  }
}
