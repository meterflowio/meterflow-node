import { describe, it, expect, vi, beforeEach } from "vitest";
import { retryable } from "../../src/utils/retry";
import { RateLimitError, ServerError, AuthError, ValidationError } from "../../src/errors";

vi.useFakeTimers();

describe("retryable", () => {
  beforeEach(() => {
    vi.clearAllTimers();
  });

  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryable(fn, { retries: 3, factor: 2, jitter: false, maxDelayMs: 10_000 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on 2nd attempt", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new ServerError("bad")).mockResolvedValue("ok");
    const promise = retryable(fn, { retries: 3, factor: 2, jitter: false, maxDelayMs: 10_000 });
    // advance past the 1s delay for attempt 0 (factor=2, no jitter → 1000ms)
    await vi.advanceTimersByTimeAsync(1500);
    expect(await promise).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries and rethrows", async () => {
    const err = new ServerError("down");
    const fn = vi.fn().mockRejectedValue(err);
    const promise = retryable(fn, { retries: 3, factor: 2, jitter: false, maxDelayMs: 10_000 });
    // attach rejection handler immediately to prevent unhandled rejection
    const check = expect(promise).rejects.toThrow("down");
    // advance past all delays: 1000 + 2000 + 4000 = 7000ms
    await vi.advanceTimersByTimeAsync(8000);
    await check;
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("does not retry when shouldRetry returns false", async () => {
    const err = new AuthError("forbidden");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      retryable(fn, { retries: 3, factor: 2, jitter: false, maxDelayMs: 10_000 }, () => false),
    ).rejects.toThrow("forbidden");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses Retry-After from RateLimitError for delay", async () => {
    const rateLimitErr = new RateLimitError("too many requests", 5);
    const fn = vi.fn().mockRejectedValueOnce(rateLimitErr).mockResolvedValue("done");
    const promise = retryable(fn, { retries: 3, factor: 2, jitter: false, maxDelayMs: 10_000 }, () => true);
    // advance by exactly 5s (Retry-After)
    await vi.advanceTimersByTimeAsync(5100);
    expect(await promise).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx non-rate-limit errors via shouldRetry", async () => {
    const err = new ValidationError("bad input");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      retryable(fn, { retries: 3, factor: 2, jitter: false, maxDelayMs: 10_000 }, (e) => {
        if (e instanceof ValidationError) return false;
        return true;
      }),
    ).rejects.toThrow("bad input");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("caps delay at maxDelayMs", async () => {
    const sleepSpy = vi.spyOn(global, "setTimeout");
    const fn = vi.fn().mockRejectedValueOnce(new ServerError("err")).mockResolvedValue("ok");
    const promise = retryable(fn, { retries: 3, factor: 100, jitter: false, maxDelayMs: 500 });
    await vi.advanceTimersByTimeAsync(600);
    await promise;
    const delay = sleepSpy.mock.calls.find((c) => Number(c[1]) > 0)?.[1] ?? 0;
    expect(Number(delay)).toBeLessThanOrEqual(500);
  });

  it("retries on generic network errors (non-MeterFlowError)", async () => {
    const networkError = new TypeError("fetch failed");
    const fn = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValue("recovered");
    const promise = retryable(fn, { retries: 3, factor: 2, jitter: false, maxDelayMs: 10_000 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await promise).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
