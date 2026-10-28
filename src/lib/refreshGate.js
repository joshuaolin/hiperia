export class RefreshCooldownError extends Error {
  constructor(retryAt, rateLimited) {
    super("Wait before refreshing again.");
    this.retryAt = retryAt;
    this.rateLimited = rateLimited;
  }
}

export function isRateLimitError(error) {
  for (
    let current = error, depth = 0;
    current && depth < 4;
    current = current.cause, depth += 1
  ) {
    if (
      [current.status, current.statusCode, current.response?.status].includes(
        429,
      ) ||
      current.code === -32005 ||
      /\b429\b|rate.?limit|too many requests/i.test(current.message || "")
    )
      return true;
  }
  return false;
}

function retryAfterMilliseconds(error, now) {
  for (
    let current = error, depth = 0;
    current && depth < 4;
    current = current.cause, depth += 1
  ) {
    if (Number.isFinite(current.retryAfterMs) && current.retryAfterMs > 0)
      return current.retryAfterMs;
    const headers = current.response?.headers ?? current.headers;
    const value =
      current.retryAfter ??
      (typeof headers?.get === "function"
        ? headers.get("retry-after")
        : headers?.["retry-after"]);
    if (value == null) continue;
    if (Number.isFinite(Number(value)) && Number(value) >= 0)
      return Number(value) * 1000;
    const deadline = Date.parse(value);
    if (Number.isFinite(deadline) && deadline > now) return deadline - now;
  }
  return 0;
}

export class RefreshGate {
  constructor({ now = Date.now, minimumInterval = 8000 } = {}) {
    this.now = now;
    this.minimumInterval = minimumInterval;
    this.lastStartedAt = -Infinity;
    this.retryAt = 0;
    this.rateLimitFailures = 0;
    this.pending = null;
  }

  get nextManualRefreshAt() {
    return Math.max(this.lastStartedAt + this.minimumInterval, this.retryAt);
  }

  run(read, { manual = false, freshAfterPending = false } = {}) {
    if (this.pending) {
      if (freshAfterPending)
        return this.pending.catch(() => {}).then(() => this.run(read));
      return this.pending;
    }
    const now = this.now();
    if (now < this.retryAt)
      return Promise.reject(new RefreshCooldownError(this.retryAt, true));
    if (manual && now < this.nextManualRefreshAt)
      return Promise.reject(
        new RefreshCooldownError(this.nextManualRefreshAt, false),
      );
    this.lastStartedAt = now;
    this.pending = Promise.resolve()
      .then(read)
      .then(
        (value) => {
          this.retryAt = 0;
          this.rateLimitFailures = 0;
          return value;
        },
        (error) => {
          if (isRateLimitError(error)) {
            this.rateLimitFailures += 1;
            const backoff = Math.min(
              60_000,
              this.minimumInterval *
                2 ** Math.min(this.rateLimitFailures - 1, 4),
            );
            this.retryAt =
              this.now() +
              Math.min(
                60_000,
                Math.max(backoff, retryAfterMilliseconds(error, this.now())),
              );
          }
          throw error;
        },
      )
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}
