export class Budget {
  constructor({
    signal,
    now = () => Date.now(),
    durationMs = 30000,
    requestTimeoutMs = 5000,
    modelTimeoutMs = 8000,
  } = {}) {
    this.requestTimeoutMs = requestTimeoutMs;
    this.modelTimeoutMs = modelTimeoutMs;
    this.now = now;
    this.startedAt = now();
    this.deadline = now() + durationMs;
    this.signal = signal;
    this.counts = {
      retrieval: 0,
      detail: 0,
      wiki: 0,
      playability: 0,
      model: 0,
    };
    this.calls = [];
    this.active = 0;
    this.waiters = [];
  }
  remaining() {
    return this.deadline - this.now();
  }
  async call(kind, label, fn) {
    const caps = {
      retrieval: 12,
      detail: 5,
      wiki: 10,
      playability: 8,
      model: 4,
    };
    if (
      this.signal?.aborted ||
      this.remaining() < 100 ||
      this.counts[kind] >= caps[kind]
    )
      throw Object.assign(new Error("请求预算已用尽"), { status: "budget" });
    if (!Object.hasOwn(caps, kind)) throw new Error("unknown_budget_kind");
    this.counts[kind]++;
    if (this.active >= 4)
      await new Promise((resolve) => this.waiters.push(resolve));
    else this.active++;
    const started = this.now();
    let cleanup = () => {};
    try {
      if (this.signal?.aborted || this.remaining() < 100)
        throw Object.assign(new Error("请求已取消或截止"), {
          status: "budget",
        });
      const controller = new AbortController();
      const delay = Math.max(
        1,
        Math.min(
          kind === "model" ? this.modelTimeoutMs : this.requestTimeoutMs,
          this.remaining()
        )
      );
      const signal = this.signal
        ? AbortSignal.any([this.signal, controller.signal])
        : controller.signal;
      const value = await new Promise((resolve, reject) => {
        const abort = () =>
          reject(
            Object.assign(
              new Error(this.signal?.aborted ? "请求已取消" : "请求超时"),
              { status: this.signal?.aborted ? "cancelled" : "timeout" }
            )
          );
        const timer = setTimeout(() => controller.abort(), delay);
        cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve()
          .then(() => fn(signal))
          .then(resolve, reject);
      });
      if (this.remaining() <= 0)
        throw Object.assign(new Error("推荐时限已到"), { status: "budget" });
      this.calls.push({
        kind,
        label,
        status: "ok",
        durationMs: this.now() - started,
      });
      return value;
    } catch (error) {
      this.calls.push({
        kind,
        label,
        status: error.status || "error",
        durationMs: this.now() - started,
      });
      throw error;
    } finally {
      cleanup();
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
