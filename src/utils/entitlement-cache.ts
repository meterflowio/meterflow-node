import { MeterFlowError, RateLimitError, ServerError } from "../errors";

/** How many answers one client keeps; the least recently used goes first past it. */
export const MAX_CACHED_ENTITLEMENTS = 1_000;

interface CachedAnswer {
  customerId: string;
  value: unknown;
  /** Epoch milliseconds after which the answer is no longer fresh; it is still kept as a fallback. */
  freshUntil: number;
}

/**
 * The seconds a response may be reused for, from its `Cache-Control`: `max-age`, or 0 when the
 * header is absent, says `no-store` / `no-cache`, or names no positive age.
 * header: the response's `Cache-Control` value, or null.
 */
export function maxAgeSeconds(header: string | null): number {
  if (!header || /\bno-(store|cache)\b/i.test(header)) return 0;
  const match = /\bmax-age=(\d+)/i.exec(header);
  return match ? Number(match[1]) : 0;
}

/**
 * Whether a failed call is MeterFlow being unreachable rather than an answer: no response at all
 * (network error, timeout), a 5xx after the retries, or a 429. A 401, 403, 404 or 422 is an answer.
 * error: what the call threw.
 */
export function isOutage(error: unknown): boolean {
  if (!(error instanceof MeterFlowError)) return true;
  return error instanceof ServerError || error instanceof RateLimitError;
}

/**
 * The entitlement answers one client has read, each fresh for the `max-age` the API sent and kept
 * past it as the fallback for an outage. Bounded, least recently used out first.
 */
export class EntitlementCache {
  private readonly answers = new Map<string, CachedAnswer>();

  /**
   * The answer stored under `key`, with whether it is still fresh; undefined when there is none.
   * key: the call's cache key.
   */
  read(key: string): { value: unknown; fresh: boolean } | undefined {
    const cached = this.answers.get(key);
    if (cached === undefined) return undefined;
    this.answers.delete(key);
    this.answers.set(key, cached);
    return { value: cached.value, fresh: Date.now() < cached.freshUntil };
  }

  /**
   * Keep an answer for `seconds`; nothing is kept when that is 0.
   * key: the call's cache key.
   * customerId: whose answer it is, so a write for them can expire it.
   * value: the answer.
   * seconds: how long it stays fresh.
   */
  write(key: string, customerId: string, value: unknown, seconds: number): void {
    if (seconds <= 0) return;
    this.answers.delete(key);
    this.answers.set(key, { customerId, value, freshUntil: Date.now() + seconds * 1_000 });
    if (this.answers.size > MAX_CACHED_ENTITLEMENTS) {
      const oldest = this.answers.keys().next().value;
      if (oldest !== undefined) this.answers.delete(oldest);
    }
  }

  /**
   * Make every answer for a customer stale, after a write that changed what they may do. They stay as an outage fallback.
   * customerId: the customer written for.
   */
  invalidate(customerId: string): void {
    for (const cached of this.answers.values()) {
      if (cached.customerId === customerId) cached.freshUntil = 0;
    }
  }
}
