/** Cache only successful probes, measured from completion; never serve expired success. */
export class ReadinessCache<T> {
  #cached: { value: T; expiresAt: number } | undefined;
  #pending: Promise<T> | undefined;
  constructor(private readonly now: () => number = Date.now) {}
  get(probe: () => Promise<T>, ttlMs: number): Promise<T> {
    if (this.#cached && this.#cached.expiresAt > this.now()) return Promise.resolve(this.#cached.value);
    if (this.#pending) return this.#pending;
    this.#pending = Promise.resolve().then(probe).then(value => {
      this.#cached = { value, expiresAt: this.now() + ttlMs };
      return value;
    }).finally(() => { this.#pending = undefined; });
    return this.#pending;
  }
}
