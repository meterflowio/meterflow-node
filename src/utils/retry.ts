import { RateLimitError } from "../errors";

export interface RetryOptions {
  retries: number;
  factor: number;
  jitter: boolean;
  maxDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryable<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
  shouldRetry: (err: unknown) => boolean = (): boolean => true,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLast = attempt === opts.retries;
      if (isLast || !shouldRetry(err)) {
        throw err;
      }

      let delayMs: number;
      if (err instanceof RateLimitError && err.retryAfter != null) {
        delayMs = err.retryAfter * 1000;
      } else {
        const baseMs = Math.min(1000 * Math.pow(opts.factor, attempt), opts.maxDelayMs);
        delayMs = opts.jitter ? baseMs * (0.75 + Math.random() * 0.5) : baseMs;
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}
