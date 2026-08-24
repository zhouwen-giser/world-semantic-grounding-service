export class QueueCapacityError extends Error {
  readonly code = "QUEUE_CAPACITY_EXCEEDED";

  constructor() {
    super("The bounded worker queue is full");
  }
}

export class QueueClosedError extends Error {
  readonly code = "QUEUE_CLOSED";

  constructor() {
    super("The worker queue is closed");
  }
}

interface QueuedItem<T> {
  value: T;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface QueueState {
  active: number;
  queued: number;
  accepting: boolean;
}

export class BoundedWorkQueue<T> {
  readonly #concurrency: number;
  readonly #maxQueued: number;
  readonly #run: (value: T, signal: AbortSignal) => Promise<void>;
  readonly #queued: QueuedItem<T>[] = [];
  readonly #active = new Set<AbortController>();
  #accepting = true;
  #idleWaiters: Array<() => void> = [];

  constructor(config: {
    concurrency: number;
    maxQueued: number;
    run: (value: T, signal: AbortSignal) => Promise<void>;
  }) {
    if (!Number.isInteger(config.concurrency) || config.concurrency < 1) throw new Error("concurrency must be a positive integer");
    if (!Number.isInteger(config.maxQueued) || config.maxQueued < 0) throw new Error("maxQueued must be a non-negative integer");
    this.#concurrency = config.concurrency;
    this.#maxQueued = config.maxQueued;
    this.#run = config.run;
  }

  state(): QueueState {
    return { active: this.#active.size, queued: this.#queued.length, accepting: this.#accepting };
  }

  submit(value: T): Promise<void> {
    if (!this.#accepting) return Promise.reject(new QueueClosedError());
    if (this.#active.size >= this.#concurrency && this.#queued.length >= this.#maxQueued) {
      return Promise.reject(new QueueCapacityError());
    }
    const completion = new Promise<void>((resolve, reject) => this.#queued.push({ value, resolve, reject }));
    this.#pump();
    return completion;
  }

  async shutdown(graceMs: number): Promise<{ drained: boolean; aborted: number }> {
    if (!Number.isInteger(graceMs) || graceMs < 0) throw new Error("graceMs must be a non-negative integer");
    this.#accepting = false;
    const closed = new QueueClosedError();
    for (const item of this.#queued.splice(0)) item.reject(closed);
    if (this.#active.size === 0) return { drained: true, aborted: 0 };

    const drained = await Promise.race([
      this.#whenIdle().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs))
    ]);
    if (drained) return { drained: true, aborted: 0 };
    const active = [...this.#active];
    active.forEach((controller) => controller.abort(new Error("worker shutdown deadline elapsed")));
    return { drained: false, aborted: active.length };
  }

  #whenIdle(): Promise<void> {
    if (this.#active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  #pump(): void {
    while (this.#accepting && this.#active.size < this.#concurrency && this.#queued.length > 0) {
      const item = this.#queued.shift();
      if (!item) return;
      const controller = new AbortController();
      this.#active.add(controller);
      void this.#run(item.value, controller.signal)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.#active.delete(controller);
          if (this.#active.size === 0) {
            for (const resolve of this.#idleWaiters.splice(0)) resolve();
          }
          this.#pump();
        });
    }
  }
}
